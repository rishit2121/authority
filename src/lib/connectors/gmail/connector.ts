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

type GmailOperationSlug = "send_email" | "list_messages" | "get_message" | "list_labels";

interface GmailRequestPlan {
  method: "GET" | "POST";
  path: string;
  resource: string;
  query?: URLSearchParams;
  body?: string;
}

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

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`"${key}" must be a non-empty string.`);
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

const MAX_LIST_RESULTS = 50;
const DEFAULT_LIST_RESULTS = 10;

/**
 * Builds the exact Gmail request for one operation slug, from already
 * schema-validated plan-builder arguments -- the same role as Stripe's own
 * `planRequest` (../stripe/connector.ts). `send_email` is the only write;
 * the rest are reads added so a broader OAuth grant (see ../oauth.ts) has
 * real, individually-audited operations to back it, rather than ever
 * forwarding an agent-constructed request to Gmail's API directly.
 */
function planRequest(slug: GmailOperationSlug, args: Record<string, unknown>): GmailRequestPlan {
  switch (slug) {
    case "send_email": {
      const to = requireHeaderSafeString(args, "to");
      const subject = requireHeaderSafeString(args, "subject");
      const body = optionalString(args, "body");
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
      return {
        method: "POST",
        path: "/gmail/v1/users/me/messages/send",
        resource,
        body: JSON.stringify({ raw: buildRawMessage(to, subject, body) }),
      };
    }
    case "list_messages": {
      const query = optionalString(args, "query");
      const rawMax = args.max_results;
      const requested =
        typeof rawMax === "number" && Number.isInteger(rawMax) ? rawMax : DEFAULT_LIST_RESULTS;
      const maxResults = Math.min(Math.max(requested, 1), MAX_LIST_RESULTS);
      const params = new URLSearchParams({ maxResults: String(maxResults) });
      if (query) params.set("q", query);
      // Unscoped, like slack.list_channels (../slack/connector.ts) -- this
      // lists across the whole mailbox, so there is no single identified
      // resource to bind a capability against.
      return { method: "GET", path: "/gmail/v1/users/me/messages", resource: "inbox", query: params };
    }
    case "get_message": {
      const messageId = requireString(args, "message_id");
      return {
        method: "GET",
        path: `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
        resource: messageId,
        query: new URLSearchParams({ format: "full" }),
      };
    }
    case "list_labels":
      return { method: "GET", path: "/gmail/v1/users/me/labels", resource: "labels" };
  }
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

function splitTool(tool: string): GmailOperationSlug {
  const dot = tool.indexOf(".");
  if (dot <= 0 || dot === tool.length - 1) throw new Error(`"${tool}" is not a valid tool name.`);
  const slug = tool.slice(dot + 1);
  if (slug !== "send_email" && slug !== "list_messages" && slug !== "get_message" && slug !== "list_labels") {
    throw new Error(`Gmail connector does not implement "${tool}".`);
  }
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

  async function call(
    accessToken: string,
    plan: GmailRequestPlan,
    options: { signal?: AbortSignal } = {},
  ): Promise<SafeFetchResult> {
    const url = new URL(`https://${gmailApiHostname()}${plan.path}`);
    if (plan.query) url.search = plan.query.toString();
    return deps.fetch({
      url,
      method: plan.method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(plan.body ? { "content-type": "application/json; charset=utf-8" } : {}),
      },
      body: plan.body,
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
      const plan = planRequest(slug, args);
      return { tool: `${GMAIL_CONNECTOR_ID}.${slug}`, operation: tool, resource: plan.resource, args };
    },

    async execute(
      request: NormalizedConnectorRequest,
      context: ConnectorExecutionContext,
    ): Promise<ConnectorExecutionResult> {
      const slug = splitTool(request.operation);
      const plan = planRequest(slug, request.args);

      // Obtaining an access token has no side effect of its own, so a
      // revoked/expired refresh token fails here as a definite `failed`,
      // before the one call that can actually leave a message sent.
      const accessToken = await accessTokenFor(context.connectionId);

      const isWrite = slug === "send_email";
      if (isWrite) context.beforeWrite();

      const response = await call(accessToken, plan, { signal: context.signal });
      const httpStatusClass = Math.floor(response.status / 100);
      if (httpStatusClass !== 2) {
        throw new Error(httpStatusClass === 4 ? "UPSTREAM_CLIENT_ERROR" : "UPSTREAM_SERVER_ERROR");
      }

      const payload = JSON.parse(response.bodyText || "{}") as Record<string, unknown>;
      return {
        category: "succeeded",
        resourceIds: { resource: plan.resource },
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
