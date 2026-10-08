import "server-only";

import { getConnectorConnectionConfig, resolveConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";

import { safeFetch, type SafeFetchInput, type SafeFetchResult } from "../custom-api/network-guard";

import type {
  AuthorityConnector,
  ConnectorContext,
  ConnectorExecutionContext,
  ConnectorExecutionResult,
  ConnectorHealthResult,
  IndeterminateExecution,
  NormalizedConnectorRequest,
  ReconciliationResult,
} from "../types";
import type { ToolOperation } from "@/lib/registry/types";

/** Fixed host: Linear's own GraphQL API, never tenant-configurable. */
const LINEAR_API_HOSTNAME = "api.linear.app";

export const LINEAR_CONNECTOR_ID = "linear";

type LinearOperationSlug = "list_issues" | "get_issue" | "create_issue";

interface LinearRequestPlan {
  resource: string;
  query: string;
  variables: Record<string, unknown>;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`"${key}" must be a non-empty string.`);
  }
  return v;
}

function optionalString(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Builds the exact GraphQL request for one operation slug -- the static-
 * registry equivalent of Custom API's tenant-authored request-builder,
 * except every query/mutation string here is registry-fixed code, not
 * tenant data. Linear exposes a single GraphQL endpoint rather than a REST
 * surface, so unlike Stripe's `planRequest` (method+path), this plans a
 * query string and a variables object instead -- something Custom API's
 * flat-scalar, one-field-one-body-key model could never express.
 */
function planRequest(slug: LinearOperationSlug, args: Record<string, unknown>): LinearRequestPlan {
  switch (slug) {
    case "list_issues": {
      const teamId = requireString(args, "team_id");
      return {
        resource: teamId,
        query:
          "query($teamId: String!) { issues(filter: { team: { id: { eq: $teamId } } }, first: 50) " +
          "{ nodes { id identifier title url state { name } } } }",
        variables: { teamId },
      };
    }
    case "get_issue": {
      const issueId = requireString(args, "issue_id");
      return {
        resource: issueId,
        query:
          "query($id: String!) { issue(id: $id) " +
          "{ id identifier title description url state { name } assignee { name } } }",
        variables: { id: issueId },
      };
    }
    case "create_issue": {
      const teamId = requireString(args, "team_id");
      const title = requireString(args, "title");
      return {
        resource: teamId,
        query:
          "mutation($teamId: String!, $title: String!, $description: String) { issueCreate(input: " +
          "{ teamId: $teamId, title: $title, description: $description }) " +
          "{ success issue { id identifier url } } }",
        variables: { teamId, title, description: optionalString(args, "description") },
      };
    }
  }
}

function splitTool(tool: string): LinearOperationSlug {
  const dot = tool.indexOf(".");
  if (dot <= 0 || dot === tool.length - 1) throw new Error(`"${tool}" is not a valid tool name.`);
  const slug = tool.slice(dot + 1);
  if (slug !== "list_issues" && slug !== "get_issue" && slug !== "create_issue") {
    throw new Error(`Linear connector does not implement "${tool}".`);
  }
  return slug;
}

export interface LinearConnectorDeps {
  getConnectionConfig: typeof getConnectorConnectionConfig;
  resolveSecret: typeof resolveConnectorSecret;
  fetch: (input: SafeFetchInput) => Promise<SafeFetchResult>;
}

export const defaultLinearConnectorDeps: LinearConnectorDeps = {
  getConnectionConfig: getConnectorConnectionConfig,
  resolveSecret: resolveConnectorSecret,
  fetch: safeFetch,
};

interface LinearGraphQlResponse {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
}

function parseGraphQlResponse(bodyText: string): LinearGraphQlResponse {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    return parsed && typeof parsed === "object" ? (parsed as LinearGraphQlResponse) : {};
  } catch {
    return {};
  }
}

export function createLinearConnector(
  deps: LinearConnectorDeps = defaultLinearConnectorDeps,
): AuthorityConnector {
  async function apiKeyFor(connectionId: string): Promise<string> {
    const key = await deps.resolveSecret(connectionId, "api_key");
    if (!key) throw new Error("CREDENTIAL_NOT_CONFIGURED");
    return key;
  }

  async function call(
    connectionId: string,
    query: string,
    variables: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<SafeFetchResult> {
    const apiKey = await apiKeyFor(connectionId);
    return deps.fetch({
      url: new URL(`https://${LINEAR_API_HOSTNAME}/graphql`),
      method: "POST",
      headers: {
        // Linear's personal API keys are sent as the raw Authorization value
        // -- no "Bearer " prefix, unlike most providers this framework talks
        // to (confirmed against Linear's own API reference).
        authorization: apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      timeoutMs: 10_000,
      signal: options.signal,
    });
  }

  return {
    id: LINEAR_CONNECTOR_ID,

    // The trusted Linear operations live in the static registry
    // (src/lib/registry/fixtures/github-demo.ts) -- this list is
    // informational only, kept in sync by hand, exactly like Stripe's own
    // `describeOperations`.
    describeOperations(): ToolOperation[] {
      return [];
    },

    async verifyInstallation(context: ConnectorContext): Promise<ConnectorHealthResult> {
      const connection = await deps.getConnectionConfig(context.connectionId);
      if (!connection) {
        return { status: "disconnected", reasons: ["CONNECTION_NOT_FOUND"], lastVerifiedAt: null };
      }
      const hasKey = await deps.resolveSecret(context.connectionId, "api_key");
      if (!hasKey) {
        return { status: "not_configured", reasons: ["API_KEY_NOT_CONFIGURED"], lastVerifiedAt: null };
      }
      if (connection.status !== "active") {
        return { status: "suspended", reasons: [], lastVerifiedAt: connection.lastVerifiedAt };
      }
      try {
        const response = await call(context.connectionId, "{ viewer { id } }", {});
        if (response.status === 401) {
          return {
            status: "permission_drift",
            reasons: ["PERMISSION_MISSING:api_key"],
            lastVerifiedAt: connection.lastVerifiedAt,
          };
        }
        const parsed = parseGraphQlResponse(response.bodyText);
        const viewerOk = Boolean((parsed.data as { viewer?: unknown } | undefined)?.viewer);
        if (Math.floor(response.status / 100) !== 2 || (parsed.errors?.length ?? 0) > 0 || !viewerOk) {
          return {
            status: "permission_drift",
            reasons: [`UPSTREAM_STATUS_${response.status}`],
            lastVerifiedAt: connection.lastVerifiedAt,
          };
        }
        return { status: "active", reasons: [], lastVerifiedAt: connection.lastVerifiedAt };
      } catch {
        return {
          status: "permission_drift",
          reasons: ["VERIFY_CALL_FAILED"],
          lastVerifiedAt: connection.lastVerifiedAt,
        };
      }
    },

    async normalizeRequest(tool: string, input: unknown): Promise<NormalizedConnectorRequest> {
      const slug = splitTool(tool);
      const args = (input as Record<string, unknown>) ?? {};
      const plan = planRequest(slug, args);
      return { tool: `${LINEAR_CONNECTOR_ID}.${slug}`, operation: tool, resource: plan.resource, args };
    },

    async execute(
      request: NormalizedConnectorRequest,
      context: ConnectorExecutionContext,
    ): Promise<ConnectorExecutionResult> {
      const slug = splitTool(request.operation);
      const plan = planRequest(slug, request.args);

      const isWrite = slug === "create_issue";
      if (isWrite) context.beforeWrite();

      const response = await call(context.connectionId, plan.query, plan.variables, {
        signal: context.signal,
      });
      const httpStatusClass = Math.floor(response.status / 100);
      if (httpStatusClass !== 2) {
        throw new Error(httpStatusClass === 4 ? "UPSTREAM_CLIENT_ERROR" : "UPSTREAM_SERVER_ERROR");
      }
      const parsed = parseGraphQlResponse(response.bodyText);
      if ((parsed.errors?.length ?? 0) > 0) {
        // A GraphQL error (bad filter, not-found team/issue id, etc.) rides
        // back on HTTP 200 -- Linear's own convention, unlike Stripe's REST
        // status codes. Still classified and settled as a definite client
        // error, never silently treated as a success.
        throw new Error("UPSTREAM_CLIENT_ERROR");
      }

      return {
        category: "succeeded",
        resourceIds: { resource: plan.resource },
        providerRequestId: response.headers.get("request-id"),
        httpStatusClass,
        agentPayload: parsed.data ?? {},
        redaction: {},
      };
    },

    async reconcile(execution: IndeterminateExecution): Promise<ReconciliationResult> {
      // Linear's GraphQL API has no generic "look up what my last mutation
      // did" query this reconcile path could call without inventing a new
      // search by content, which risks matching the wrong issue. Until this
      // connector has a safe, idempotent re-query for `issueCreate`, an
      // indeterminate create always resolves manually, same as Stripe.
      void execution;
      return {
        outcome: "still_unknown",
        detail: "Linear reconciliation by a safe idempotent re-query is not yet implemented.",
      };
    },
  };
}

export const linearConnector: AuthorityConnector = createLinearConnector();
