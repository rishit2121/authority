import "server-only";

import {
  getConnectorConnectionConfig,
  resolveConnectorSecret,
} from "@/lib/gateway/rpc-connector-secrets";
import { getPublishedCustomOperation, type PublishedCustomOperation } from "@/lib/gateway/rpc-custom-operations";

import { connectionIdFromCustomApiConnectorId, CUSTOM_API_CONNECTOR_PREFIX } from "./connection-id";
import { CUSTOM_API_FIXTURE_HOSTNAME, customApiFixtureModeEnabled } from "./fixture-mode";
import { customApiFixtureServer } from "./fixture-server";
import { validateDestinationUrl, safeFetch, type SafeFetchInput, type SafeFetchResult } from "./network-guard";
import { buildRequest } from "./request-builder";
import { CustomOperationValidationError, type CustomOperationInputSchema, type CustomOperationRequestMapping } from "./types";

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

/**
 * Custom API: the one connector whose operations are tenant-published, not
 * part of the static trusted registry (Phase 5 of the agent-integration
 * roadmap). Everything that would normally live in a registry fixture
 * instead lives in `custom_operation_definitions`, gated by the
 * draft -> validated -> published lifecycle (20261001000005). This connector
 * is a single process-wide singleton registered under the dynamic prefix
 * "custom_" (see registry.ts's prefix matching) -- it serves every tenant's
 * every Custom API connection, deriving which one applies from the tool name
 * itself via `connectionIdFromCustomApiConnectorId`.
 *
 * Dependency-injected (mirroring `ConnectorExecutorDeps` / GitHub's
 * `ExecutorDeps`) so tests can swap the database reads and, critically, the
 * outbound HTTP call itself for an in-memory fixture -- there is no "mock
 * mode" equivalent to GitHub's `mockGithub` for a connector whose target API
 * is a different arbitrary tenant endpoint every time; the seam has to be at
 * `fetch`, not at a fixed fake transport.
 */

export interface CustomApiConnectorDeps {
  getPublishedOperation: typeof getPublishedCustomOperation;
  getConnectionConfig: typeof getConnectorConnectionConfig;
  resolveSecret: typeof resolveConnectorSecret;
  fetch: (input: SafeFetchInput) => Promise<SafeFetchResult>;
}

/**
 * Routes exactly one reserved hostname to the in-process fixture server when
 * fixture mode is explicitly enabled (see fixture-mode.ts); every other
 * destination -- and the fixture hostname itself when the mode is off --
 * always goes through the real `safeFetch`, full SSRF guard included. A
 * production deployment with the flag unset (the only supported
 * configuration) behaves exactly as if this function did not exist.
 */
async function fetchWithOptionalFixture(input: SafeFetchInput): Promise<SafeFetchResult> {
  if (customApiFixtureModeEnabled() && input.url.hostname === CUSTOM_API_FIXTURE_HOSTNAME) {
    return customApiFixtureServer().handle(input);
  }
  return safeFetch(input);
}

export const defaultCustomApiConnectorDeps: CustomApiConnectorDeps = {
  getPublishedOperation: getPublishedCustomOperation,
  getConnectionConfig: getConnectorConnectionConfig,
  resolveSecret: resolveConnectorSecret,
  fetch: fetchWithOptionalFixture,
};

function splitTool(tool: string): { connectionId: string; operationSlug: string } {
  const dot = tool.indexOf(".");
  if (dot <= 0 || dot === tool.length - 1) {
    throw new CustomOperationValidationError("TOOL_MALFORMED", `"${tool}" is not a valid tool name.`);
  }
  const provider = tool.slice(0, dot);
  const operationSlug = tool.slice(dot + 1);
  const connectionId = connectionIdFromCustomApiConnectorId(provider);
  if (!connectionId) {
    throw new CustomOperationValidationError("TOOL_MALFORMED", `"${provider}" is not a Custom API connector id.`);
  }
  return { connectionId, operationSlug };
}

function baseUrlOf(op: PublishedCustomOperation): string {
  const raw = op.connectionConfig.baseUrl;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new CustomOperationValidationError("CONNECTOR_NOT_CONFIGURED", "This connection has no base URL configured.");
  }
  validateDestinationUrl(raw);
  return raw;
}

function agentPayloadFrom(
  bodyText: string,
  contentType: string | null,
): { payload: Record<string, unknown>; redaction: Record<string, number> } {
  if (!bodyText) return { payload: {}, redaction: {} };
  if (contentType?.includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(bodyText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { payload: parsed as Record<string, unknown>, redaction: {} };
      }
      return { payload: { value: parsed as unknown }, redaction: {} };
    } catch {
      return { payload: { raw: bodyText }, redaction: {} };
    }
  }
  return { payload: { raw: bodyText }, redaction: {} };
}

export function createCustomApiConnector(deps: CustomApiConnectorDeps = defaultCustomApiConnectorDeps): AuthorityConnector {
  async function loadPublished(tool: string): Promise<{ connectionId: string; op: PublishedCustomOperation }> {
    const { connectionId, operationSlug } = splitTool(tool);
    const op = await deps.getPublishedOperation(connectionId, operationSlug);
    if (!op) {
      throw new CustomOperationValidationError(
        "OPERATION_NOT_PUBLISHED",
        "This operation is not published on this connection.",
      );
    }
    return { connectionId, op };
  }

  async function resolveAuthHeaders(op: PublishedCustomOperation, connectionId: string): Promise<Record<string, string>> {
    switch (op.authType) {
      case "none":
        return {};
      case "bearer": {
        const token = await deps.resolveSecret(connectionId, "bearer_token");
        if (!token) throw new CustomOperationValidationError("CREDENTIAL_NOT_CONFIGURED", "No bearer token is configured.");
        return { authorization: `Bearer ${token}` };
      }
      case "api_key_header": {
        const headerName = (op.authConfig as { headerName?: string }).headerName;
        if (!headerName) throw new CustomOperationValidationError("OPERATION_MISCONFIGURED", "No header name configured for the API key.");
        const key = await deps.resolveSecret(connectionId, "api_key");
        if (!key) throw new CustomOperationValidationError("CREDENTIAL_NOT_CONFIGURED", "No API key is configured.");
        return { [headerName]: key };
      }
      case "basic": {
        const [username, password] = await Promise.all([
          deps.resolveSecret(connectionId, "basic_username"),
          deps.resolveSecret(connectionId, "basic_password"),
        ]);
        if (!username || !password) {
          throw new CustomOperationValidationError("CREDENTIAL_NOT_CONFIGURED", "Basic auth credentials are not fully configured.");
        }
        return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
      }
      default:
        throw new CustomOperationValidationError("OPERATION_MISCONFIGURED", `Unknown auth type "${op.authType as string}".`);
    }
  }

  function buildHttpRequest(connectionId: string, op: PublishedCustomOperation, args: Record<string, unknown>) {
    const baseUrl = baseUrlOf(op);
    return buildRequest(
      {
        connectionId,
        baseUrl,
        method: op.method,
        pathTemplate: op.pathTemplate,
        inputSchema: op.inputSchema as unknown as CustomOperationInputSchema,
        requestMapping: op.requestMapping as unknown as CustomOperationRequestMapping,
      },
      args,
    );
  }

  return {
    id: CUSTOM_API_CONNECTOR_PREFIX,

    // Custom API has no statically trusted operations of its own -- every
    // operation it exposes is a tenant's published row. Merging those into
    // the plan-builder's registry at contract-compile time is a separate,
    // not-yet-built piece of work (tracked as a known limitation); returning
    // [] here is correct, not a placeholder -- this connector contributes
    // zero operations to the *global* trusted registry, by design.
    describeOperations(): ToolOperation[] {
      return [];
    },

    async verifyInstallation(context: ConnectorContext): Promise<ConnectorHealthResult> {
      const connection = await deps.getConnectionConfig(context.connectionId);
      if (!connection) {
        return { status: "disconnected", reasons: ["CONNECTION_NOT_FOUND"], lastVerifiedAt: null };
      }
      const reasons: string[] = [];
      const baseUrl = connection.config.baseUrl;
      if (typeof baseUrl !== "string" || baseUrl.length === 0) {
        reasons.push("BASE_URL_NOT_CONFIGURED");
      } else {
        try {
          validateDestinationUrl(baseUrl);
        } catch {
          reasons.push("BASE_URL_NOT_ALLOWED");
        }
      }
      return {
        status: reasons.length > 0 ? "not_configured" : connection.status === "active" ? "active" : "suspended",
        reasons,
        lastVerifiedAt: connection.lastVerifiedAt,
      };
    },

    async normalizeRequest(tool: string, input: unknown): Promise<NormalizedConnectorRequest> {
      const { connectionId, op } = await loadPublished(tool);
      const built = buildHttpRequest(connectionId, op, (input as Record<string, unknown>) ?? {});
      return {
        tool: op.toolName,
        operation: tool,
        resource: built.resource,
        args: (input as Record<string, unknown>) ?? {},
      };
    },

    async execute(request: NormalizedConnectorRequest, context: ConnectorExecutionContext): Promise<ConnectorExecutionResult> {
      const { connectionId, op } = await loadPublished(request.operation);
      if (connectionId !== context.connectionId) {
        // Cannot happen if the tool name is well-formed (both are derived
        // from the same string), but a mismatch here must never silently
        // proceed -- this is the last check before a real request is built.
        throw new CustomOperationValidationError(
          "CONNECTION_MISMATCH",
          "The resolved connection does not match the execution context.",
        );
      }
      if (op.connectionStatus !== "active") {
        throw new CustomOperationValidationError("CONNECTION_UNAVAILABLE", "This connection is not active.");
      }
      const built = buildHttpRequest(connectionId, op, request.args);
      const authHeaders = await resolveAuthHeaders(op, connectionId);

      const isWrite = op.effect !== "read";
      if (isWrite) context.beforeWrite();

      const response = await deps.fetch({
        url: new URL(built.url),
        method: built.method,
        headers: { ...built.headers, ...authHeaders },
        body: built.body,
        timeoutMs: op.timeoutMs,
        signal: context.signal,
      });

      const contentType = response.headers.get("content-type");
      const { payload, redaction } = agentPayloadFrom(response.bodyText, contentType);
      const httpStatusClass = Math.floor(response.status / 100);
      if (httpStatusClass !== 2) {
        throw new Error(`UPSTREAM_STATUS_${response.status}`);
      }

      return {
        category: "succeeded",
        resourceIds: { resource: built.resource },
        providerRequestId: response.headers.get("x-request-id"),
        httpStatusClass,
        agentPayload: payload,
        redaction,
      };
    },

    async reconcile(_execution: IndeterminateExecution): Promise<ReconciliationResult> {
      // A generic Custom API operation has no provider-defined, safe,
      // idempotent "did this already happen" lookup -- that is specific to
      // each tenant's own API and not something this connector can know in
      // general. An indeterminate execution here always resolves manually
      // (see gateway.resolve_connector_indeterminate), never automatically.
      return { outcome: "still_unknown", detail: "Custom API operations have no generic reconciliation lookup." };
    },
  };
}

export const customApiConnector: AuthorityConnector = createCustomApiConnector();
