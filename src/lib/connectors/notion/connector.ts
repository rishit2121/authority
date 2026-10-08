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

/** Fixed host: Notion's own API, never tenant-configurable. */
const NOTION_API_HOSTNAME = "api.notion.com";

/**
 * Notion requires a version header on every request. Fixed here, in
 * connector code -- never agent-controlled and never admin-configurable the
 * way Custom API's `staticHeaders` are, since this connector has no
 * per-tenant request shape at all.
 */
const NOTION_VERSION = "2022-06-28";

/**
 * The title property name this connector assumes a target database uses --
 * "Name" is what Notion gives every new database by default. A database
 * whose title column was renamed needs that rename reflected here (a real,
 * documented limitation of create_page; see docs/connectors/notion).
 */
const TITLE_PROPERTY = "Name";

export const NOTION_CONNECTOR_ID = "notion";

type NotionOperationSlug = "retrieve_page" | "query_database" | "create_page";

interface NotionRequestPlan {
  method: "GET" | "POST";
  path: string;
  resource: string;
  body?: Record<string, unknown>;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`"${key}" must be a non-empty string.`);
  }
  return v;
}

/**
 * Builds the exact Notion request for one operation slug. Unlike Custom
 * API's tenant-authored request-builder (one declared field = one flat,
 * top-level scalar body key), `create_page` here builds a genuinely nested
 * body -- `parent.database_id` and `properties.<title>.title[0].text.content`
 * -- because this connector's request shape is fixed registry code, not a
 * tenant-declared flat schema.
 */
function planRequest(slug: NotionOperationSlug, args: Record<string, unknown>): NotionRequestPlan {
  switch (slug) {
    case "retrieve_page": {
      const pageId = requireString(args, "page_id");
      return { method: "GET", path: `/v1/pages/${encodeURIComponent(pageId)}`, resource: pageId };
    }
    case "query_database": {
      const databaseId = requireString(args, "database_id");
      return {
        method: "POST",
        path: `/v1/databases/${encodeURIComponent(databaseId)}/query`,
        resource: databaseId,
        body: {},
      };
    }
    case "create_page": {
      const databaseId = requireString(args, "database_id");
      const title = requireString(args, "title");
      return {
        method: "POST",
        path: "/v1/pages",
        resource: databaseId,
        body: {
          parent: { database_id: databaseId },
          properties: { [TITLE_PROPERTY]: { title: [{ text: { content: title } }] } },
        },
      };
    }
  }
}

function splitTool(tool: string): NotionOperationSlug {
  const dot = tool.indexOf(".");
  if (dot <= 0 || dot === tool.length - 1) throw new Error(`"${tool}" is not a valid tool name.`);
  const slug = tool.slice(dot + 1);
  if (slug !== "retrieve_page" && slug !== "query_database" && slug !== "create_page") {
    throw new Error(`Notion connector does not implement "${tool}".`);
  }
  return slug;
}

export interface NotionConnectorDeps {
  getConnectionConfig: typeof getConnectorConnectionConfig;
  resolveSecret: typeof resolveConnectorSecret;
  fetch: (input: SafeFetchInput) => Promise<SafeFetchResult>;
}

export const defaultNotionConnectorDeps: NotionConnectorDeps = {
  getConnectionConfig: getConnectorConnectionConfig,
  resolveSecret: resolveConnectorSecret,
  fetch: safeFetch,
};

function agentPayloadFrom(bodyText: string): Record<string, unknown> {
  if (!bodyText) return {};
  try {
    const parsed: unknown = JSON.parse(bodyText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { raw: bodyText };
  }
}

export function createNotionConnector(
  deps: NotionConnectorDeps = defaultNotionConnectorDeps,
): AuthorityConnector {
  async function tokenFor(connectionId: string): Promise<string> {
    const token = await deps.resolveSecret(connectionId, "bearer_token");
    if (!token) throw new Error("CREDENTIAL_NOT_CONFIGURED");
    return token;
  }

  async function call(
    connectionId: string,
    plan: NotionRequestPlan,
    options: { signal?: AbortSignal } = {},
  ): Promise<SafeFetchResult> {
    const token = await tokenFor(connectionId);
    return deps.fetch({
      url: new URL(`https://${NOTION_API_HOSTNAME}${plan.path}`),
      method: plan.method,
      headers: {
        authorization: `Bearer ${token}`,
        "notion-version": NOTION_VERSION,
        ...(plan.body ? { "content-type": "application/json" } : {}),
      },
      body: plan.body ? JSON.stringify(plan.body) : undefined,
      timeoutMs: 10_000,
      signal: options.signal,
    });
  }

  return {
    id: NOTION_CONNECTOR_ID,

    // The trusted Notion operations live in the static registry
    // (src/lib/registry/fixtures/github-demo.ts) -- kept in sync by hand,
    // exactly like Stripe's own `describeOperations`.
    describeOperations(): ToolOperation[] {
      return [];
    },

    async verifyInstallation(context: ConnectorContext): Promise<ConnectorHealthResult> {
      const connection = await deps.getConnectionConfig(context.connectionId);
      if (!connection) {
        return { status: "disconnected", reasons: ["CONNECTION_NOT_FOUND"], lastVerifiedAt: null };
      }
      const hasToken = await deps.resolveSecret(context.connectionId, "bearer_token");
      if (!hasToken) {
        return { status: "not_configured", reasons: ["TOKEN_NOT_CONFIGURED"], lastVerifiedAt: null };
      }
      if (connection.status !== "active") {
        return { status: "suspended", reasons: [], lastVerifiedAt: connection.lastVerifiedAt };
      }
      try {
        const response = await call(context.connectionId, {
          method: "GET",
          path: "/v1/users/me",
          resource: "me",
        });
        if (response.status === 401) {
          return {
            status: "permission_drift",
            reasons: ["PERMISSION_MISSING:bearer_token"],
            lastVerifiedAt: connection.lastVerifiedAt,
          };
        }
        if (Math.floor(response.status / 100) !== 2) {
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
      return { tool: `${NOTION_CONNECTOR_ID}.${slug}`, operation: tool, resource: plan.resource, args };
    },

    async execute(
      request: NormalizedConnectorRequest,
      context: ConnectorExecutionContext,
    ): Promise<ConnectorExecutionResult> {
      const slug = splitTool(request.operation);
      const plan = planRequest(slug, request.args);

      const isWrite = slug === "create_page";
      if (isWrite) context.beforeWrite();

      const response = await call(context.connectionId, plan, { signal: context.signal });
      const httpStatusClass = Math.floor(response.status / 100);
      if (httpStatusClass !== 2) {
        throw new Error(httpStatusClass === 4 ? "UPSTREAM_CLIENT_ERROR" : "UPSTREAM_SERVER_ERROR");
      }

      const payload = agentPayloadFrom(response.bodyText);
      return {
        category: "succeeded",
        resourceIds: { resource: plan.resource },
        providerRequestId: response.headers.get("request-id"),
        httpStatusClass,
        agentPayload: payload,
        redaction: {},
      };
    },

    async reconcile(execution: IndeterminateExecution): Promise<ReconciliationResult> {
      // Notion has no safe "find the page I was about to create" lookup
      // (searching by title risks matching an unrelated, pre-existing page)
      // this reconcile path could call without risking a false match. Until
      // this connector sends a client-generated page id it could re-query
      // by, an indeterminate create_page always resolves manually, same as
      // Stripe and Linear.
      void execution;
      return {
        outcome: "still_unknown",
        detail: "Notion reconciliation by a safe idempotent re-query is not yet implemented.",
      };
    },
  };
}

export const notionConnector: AuthorityConnector = createNotionConnector();
