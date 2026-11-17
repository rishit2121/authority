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

import { toolOperationsFor } from "./registry";
import {
  configValues,
  operationFor,
  parseSpec,
  planRestRequest,
  planVerifyRequest,
  RestRequestError,
  validateArgs,
  type PlannedRestRequest,
} from "./request";
import type { RestConnectorSpec } from "./spec";

/**
 * One generic `AuthorityConnector` per declarative spec. Same contract as the hand-written Linear/Notion
 * connectors: a fixed host, the stored credential resolved server-side per call, `beforeWrite()` before the first
 * byte of any write, and every network call through `safeFetch` (DNS pinning, private-address refusal, no
 * redirects, bounded response).
 */

export interface RestConnectorDeps {
  getConnectionConfig: typeof getConnectorConnectionConfig;
  resolveSecret: typeof resolveConnectorSecret;
  fetch: (input: SafeFetchInput) => Promise<SafeFetchResult>;
}

export const defaultRestConnectorDeps: RestConnectorDeps = {
  getConnectionConfig: getConnectorConnectionConfig,
  resolveSecret: resolveConnectorSecret,
  fetch: safeFetch,
};

const CALL_TIMEOUT_MS = 15_000;

function payloadFrom(bodyText: string, truncated: boolean): Record<string, unknown> {
  if (!bodyText) return {};
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (Array.isArray(parsed)) return { items: parsed };
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return truncated
      ? { raw: bodyText.slice(0, 100_000), truncated: true }
      : { raw: bodyText.slice(0, 100_000) };
  }
}

function requestId(headers: Headers): string | null {
  return headers.get("x-request-id") ?? headers.get("request-id") ?? headers.get("x-amzn-requestid") ?? null;
}

export function createRestConnector(
  input: RestConnectorSpec,
  deps: RestConnectorDeps = defaultRestConnectorDeps,
): AuthorityConnector {
  const spec = parseSpec(input);

  async function connectionFor(connectionId: string) {
    const connection = await deps.getConnectionConfig(connectionId);
    if (!connection) throw new Error("CONNECTION_NOT_FOUND");
    const secret = await deps.resolveSecret(connectionId, "api_key");
    if (!secret) throw new Error("CREDENTIAL_NOT_CONFIGURED");
    return { config: connection.config, secret };
  }

  function send(planned: PlannedRestRequest, signal?: AbortSignal): Promise<SafeFetchResult> {
    return deps.fetch({
      url: planned.url,
      method: planned.method,
      headers: planned.headers,
      body: planned.body,
      timeoutMs: CALL_TIMEOUT_MS,
      signal,
    });
  }

  return {
    id: spec.id,

    describeOperations() {
      return toolOperationsFor(spec);
    },

    async verifyInstallation(context: ConnectorContext): Promise<ConnectorHealthResult> {
      const connection = await deps.getConnectionConfig(context.connectionId);
      if (!connection)
        return { status: "disconnected", reasons: ["CONNECTION_NOT_FOUND"], lastVerifiedAt: null };
      const secret = await deps.resolveSecret(context.connectionId, "api_key");
      if (!secret)
        return { status: "not_configured", reasons: ["API_KEY_NOT_CONFIGURED"], lastVerifiedAt: null };
      try {
        configValues(spec, connection.config);
      } catch (error) {
        const reason = error instanceof RestRequestError ? error.message : "CONFIG_INVALID";
        return { status: "not_configured", reasons: [reason], lastVerifiedAt: connection.lastVerifiedAt };
      }
      if (connection.status !== "active" && connection.status !== "needs_attention") {
        return { status: "suspended", reasons: [], lastVerifiedAt: connection.lastVerifiedAt };
      }
      try {
        const response = await send(planVerifyRequest(spec, { config: connection.config, secret }));
        if (response.status === 401 || response.status === 403) {
          return {
            status: "permission_drift",
            reasons: ["PERMISSION_MISSING:api_key"],
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

    async normalizeRequest(tool: string, raw: unknown): Promise<NormalizedConnectorRequest> {
      const op = operationFor(spec, tool);
      const args = validateArgs(op, raw);
      const resource = op.resource === undefined ? "account" : String(args[op.resource]);
      return { tool: `${spec.id}.${op.slug}`, operation: tool, resource, args };
    },

    async execute(
      request: NormalizedConnectorRequest,
      context: ConnectorExecutionContext,
    ): Promise<ConnectorExecutionResult> {
      const op = operationFor(spec, request.operation);
      const args = validateArgs(op, request.args);
      const connection = await connectionFor(context.connectionId);
      const planned = planRestRequest(spec, op, args, connection);

      if (planned.isWrite) context.beforeWrite();
      const response = await send(planned, context.signal);
      const httpStatusClass = Math.floor(response.status / 100);
      if (httpStatusClass !== 2) {
        throw new Error(httpStatusClass === 4 ? "UPSTREAM_CLIENT_ERROR" : "UPSTREAM_SERVER_ERROR");
      }
      return {
        category: "succeeded",
        resourceIds: { resource: planned.resource },
        providerRequestId: requestId(response.headers),
        httpStatusClass,
        agentPayload: payloadFrom(response.bodyText, response.truncated),
        redaction: {},
      };
    },

    async reconcile(execution: IndeterminateExecution): Promise<ReconciliationResult> {
      // A generic connector has no safe way to tell whether an unanswered write happened (searching by content risks
      // matching an unrelated record), so an indeterminate write is always resolved by a person, as with Linear.
      void execution;
      return {
        outcome: "still_unknown",
        detail: "This connector cannot safely re-query an unanswered write; resolve it manually.",
      };
    },
  };
}
