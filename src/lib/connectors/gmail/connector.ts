import "server-only";

import { sanitizeResource } from "@/lib/gateway/argument-audit";
import { getConnectorConnectionConfig, resolveConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";

import {
  fetchWithOptionalFixture,
  gmailApiHostname,
  type SafeFetchInput,
  type SafeFetchResult,
} from "./fetch";
import { refreshGmailAccessToken } from "./oauth";

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

export const GMAIL_CONNECTOR_ID = "gmail";

function requireHeaderSafeString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`"${key}" must be a non-empty string.`);
  }
  // `to` and `subject` are embedded directly into raw RFC 2822 headers
  // (buildRawMessage); a newline would let an agent smuggle extra headers
  // (e.g. an injected Bcc) into a message Authority believes it fully
  // scoped. This is checked here, not left to Gmail's own API, because by
  // the time Gmail sees it the header injection has already happened.
  if (/[\r\n]/.test(v)) {
    throw new Error(`"${key}" must not contain a line break.`);
  }
  return v;
}

function optionalString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (v === undefined) return "";
  if (typeof v !== "string") throw new Error(`"${key}" must be a string.`);
  return v;
}

function buildRawMessage(to: string, subject: string, body: string): string {
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    body,
  ].join("\r\n");
  return Buffer.from(message, "utf8").toString("base64url");
}

export interface GmailConnectorDeps {
  getConnectionConfig: typeof getConnectorConnectionConfig;
  resolveSecret: typeof resolveConnectorSecret;
  fetch: (input: SafeFetchInput) => Promise<SafeFetchResult>;
  refreshAccessToken: typeof refreshGmailAccessToken;
}

export const defaultGmailConnectorDeps: GmailConnectorDeps = {
  getConnectionConfig: getConnectorConnectionConfig,
  resolveSecret: resolveConnectorSecret,
  fetch: fetchWithOptionalFixture,
  refreshAccessToken: refreshGmailAccessToken,
};

function splitTool(tool: string): "send_email" {
  const dot = tool.indexOf(".");
  if (dot <= 0 || dot === tool.length - 1) throw new Error(`"${tool}" is not a valid tool name.`);
  const slug = tool.slice(dot + 1);
  if (slug !== "send_email") throw new Error(`Gmail connector does not implement "${tool}".`);
  return slug;
}

export function createGmailConnector(
  deps: GmailConnectorDeps = defaultGmailConnectorDeps,
): AuthorityConnector {
  async function refreshTokenFor(connectionId: string): Promise<string> {
    const token = await deps.resolveSecret(connectionId, "oauth_refresh_token");
    if (!token) throw new Error("CREDENTIAL_NOT_CONFIGURED");
    return token;
  }

  /**
   * Refreshing an access token has no external side effect of its own (it
   * cannot cause an email to be sent), so it must happen -- and be allowed
   * to fail cleanly as a definite `failed`, not `indeterminate` -- before
   * `execute()` calls `context.beforeWrite()`. Only the send call itself,
   * below, is the point after which a crash must settle as indeterminate.
   */
  async function accessTokenFor(connectionId: string): Promise<string> {
    const refreshToken = await refreshTokenFor(connectionId);
    return deps.refreshAccessToken(refreshToken, deps.fetch);
  }

  async function sendMessage(
    accessToken: string,
    raw: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<SafeFetchResult> {
    return deps.fetch({
      url: new URL(`https://${gmailApiHostname()}/gmail/v1/users/me/messages/send`),
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ raw }),
      timeoutMs: 15_000,
      signal: options.signal,
    });
  }

  return {
    id: GMAIL_CONNECTOR_ID,

    // The trusted Gmail operation lives in the static registry
    // (src/lib/registry/fixtures/github-demo.ts) -- this list is
    // informational only, kept in sync by hand (see
    // ../stripe/connector.ts's own comment).
    describeOperations(): ToolOperation[] {
      return [];
    },

    async verifyInstallation(context: ConnectorContext): Promise<ConnectorHealthResult> {
      const connection = await deps.getConnectionConfig(context.connectionId);
      if (!connection) {
        return { status: "disconnected", reasons: ["CONNECTION_NOT_FOUND"], lastVerifiedAt: null };
      }
      const refreshToken = await deps.resolveSecret(context.connectionId, "oauth_refresh_token");
      if (!refreshToken) {
        return { status: "not_configured", reasons: ["OAUTH_NOT_CONNECTED"], lastVerifiedAt: null };
      }
      if (connection.status !== "active") {
        return { status: "suspended", reasons: [], lastVerifiedAt: connection.lastVerifiedAt };
      }
      try {
        // Refreshing an access token is itself a complete liveness check of
        // the stored refresh token -- Google rejects a revoked or expired
        // one with the same error shape a send would, without this
        // connector needing to make a second, separate "am I alive" call.
        await deps.refreshAccessToken(refreshToken, deps.fetch);
        return { status: "active", reasons: [], lastVerifiedAt: connection.lastVerifiedAt };
      } catch {
        return {
          status: "permission_drift",
          reasons: ["PERMISSION_MISSING:oauth_refresh_token"],
          lastVerifiedAt: connection.lastVerifiedAt,
        };
      }
    },

    async normalizeRequest(tool: string, input: unknown): Promise<NormalizedConnectorRequest> {
      const slug = splitTool(tool);
      const args = (input as Record<string, unknown>) ?? {};
      const to = requireHeaderSafeString(args, "to");
      requireHeaderSafeString(args, "subject");
      optionalString(args, "body");
      // The gateway sanitizes a capability's resource before ever comparing
      // it against what a connector reports (both at authorize time,
      // pipeline.ts, and at execute time, /api/v1/execute/route.ts): an
      // email address fails sanitizeResource's clean-charset check ("@" is
      // not in it) and is redacted to a short hash. This connector's own
      // notion of "resource" must match that exact redacted form, or a real
      // request would always reject with RESOURCE_MISMATCH -- unlike
      // Stripe/Slack/GitHub, whose resource identifiers (ids, repo slugs)
      // happen to already be in the clean charset and need no equivalent.
      const resource = sanitizeResource(to) ?? to;
      return { tool: `${GMAIL_CONNECTOR_ID}.${slug}`, operation: tool, resource, args };
    },

    async execute(
      request: NormalizedConnectorRequest,
      context: ConnectorExecutionContext,
    ): Promise<ConnectorExecutionResult> {
      splitTool(request.operation);
      const to = requireHeaderSafeString(request.args, "to");
      const subject = requireHeaderSafeString(request.args, "subject");
      const body = optionalString(request.args, "body");
      const raw = buildRawMessage(to, subject, body);

      // Obtaining an access token has no side effect of its own, so a
      // revoked/expired refresh token fails here as a definite `failed`,
      // before the one call that can actually leave a message sent.
      const accessToken = await accessTokenFor(context.connectionId);

      context.beforeWrite(); // send_email is the only Gmail operation, and it is always a write.

      const response = await sendMessage(accessToken, raw, { signal: context.signal });
      const httpStatusClass = Math.floor(response.status / 100);
      if (httpStatusClass !== 2) {
        throw new Error(httpStatusClass === 4 ? "UPSTREAM_CLIENT_ERROR" : "UPSTREAM_SERVER_ERROR");
      }

      const payload = JSON.parse(response.bodyText || "{}") as Record<string, unknown>;
      return {
        category: "succeeded",
        resourceIds: { resource: to },
        providerRequestId: typeof payload.id === "string" ? payload.id : null,
        httpStatusClass,
        agentPayload: payload,
        redaction: {},
      };
    },

    async reconcile(execution: IndeterminateExecution): Promise<ReconciliationResult> {
      // Gmail's messages.send has no safe, idempotent "did this already
      // send" lookup by content (see ../stripe/connector.ts and
      // ../slack/connector.ts's own comments on the same limitation). An
      // indeterminate send always resolves manually.
      void execution;
      return { outcome: "still_unknown", detail: "Gmail reconciliation is not yet implemented." };
    },
  };
}

export const gmailConnector: AuthorityConnector = createGmailConnector();
