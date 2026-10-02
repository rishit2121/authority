import "server-only";

import { getConnectorConnectionConfig, resolveConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";

import { safeFetch, type SafeFetchInput, type SafeFetchResult } from "../custom-api/network-guard";
import { SLACK_FIXTURE_HOSTNAME, slackFixtureModeEnabled } from "./fixture-mode";
import { slackFixtureServer } from "./fixture-server";

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

/** Fixed host: Slack's own Web API, never tenant-configurable. */
const SLACK_API_HOSTNAME = "slack.com";

export const SLACK_CONNECTOR_ID = "slack";

type SlackOperationSlug = "post_message" | "list_channels";

interface SlackRequestPlan {
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
 * Builds the exact Slack Web API request for one operation slug -- the
 * static-registry equivalent of Custom API's tenant-authored
 * request-builder.ts, except every shape here is registry-fixed code.
 */
function planRequest(slug: SlackOperationSlug, args: Record<string, unknown>): SlackRequestPlan {
  switch (slug) {
    case "post_message": {
      const channel = requireString(args, "channel");
      const text = requireString(args, "text");
      return { method: "POST", path: "/api/chat.postMessage", resource: channel, body: { channel, text } };
    }
    case "list_channels":
      return { method: "GET", path: "/api/conversations.list", resource: "workspace" };
  }
}

function splitTool(tool: string): SlackOperationSlug {
  const dot = tool.indexOf(".");
  if (dot <= 0 || dot === tool.length - 1) throw new Error(`"${tool}" is not a valid tool name.`);
  const slug = tool.slice(dot + 1);
  if (slug !== "post_message" && slug !== "list_channels") {
    throw new Error(`Slack connector does not implement "${tool}".`);
  }
  return slug;
}

export interface SlackConnectorDeps {
  getConnectionConfig: typeof getConnectorConnectionConfig;
  resolveSecret: typeof resolveConnectorSecret;
  fetch: (input: SafeFetchInput) => Promise<SafeFetchResult>;
}

/**
 * Routes the one reserved fixture hostname to the in-process fake Slack API
 * when fixture mode is explicitly enabled; every other destination -- and
 * this hostname itself when the mode is off -- always goes through the real
 * `safeFetch`. Reused from Custom API exactly as Stripe reuses it (see
 * ../stripe/connector.ts's own comment): its timeout, response-size bound,
 * and no-redirect rule apply regardless of the fixed, trusted destination.
 */
async function fetchWithOptionalFixture(input: SafeFetchInput): Promise<SafeFetchResult> {
  if (slackFixtureModeEnabled() && input.url.hostname === SLACK_FIXTURE_HOSTNAME) {
    return slackFixtureServer().handle(input);
  }
  return safeFetch(input);
}

export const defaultSlackConnectorDeps: SlackConnectorDeps = {
  getConnectionConfig: getConnectorConnectionConfig,
  resolveSecret: resolveConnectorSecret,
  fetch: fetchWithOptionalFixture,
};

function apiHostname(): string {
  return slackFixtureModeEnabled() ? SLACK_FIXTURE_HOSTNAME : SLACK_API_HOSTNAME;
}

/** Slack's own convention: HTTP 200 on every response, success/failure carried in the JSON body's `ok` field. */
interface SlackEnvelope {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

function parseSlackEnvelope(bodyText: string): SlackEnvelope {
  try {
    const parsed: unknown = JSON.parse(bodyText || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "ok" in parsed) {
      return parsed as SlackEnvelope;
    }
    return { ok: false, error: "malformed_response" };
  } catch {
    return { ok: false, error: "malformed_response" };
  }
}

/**
 * Best-effort label for which Slack workspace a bot token belongs to, so the
 * dashboard can show it instead of a bare "verified" badge. Takes the
 * plaintext token directly -- callers here already have it in hand from the
 * form submission that is about to store it. Returns null on any failure;
 * an unlabelled connection is still a working one, and this must never be
 * why saving a token fails.
 */
export async function fetchSlackWorkspaceLabel(
  botToken: string,
  fetchImpl: (input: SafeFetchInput) => Promise<SafeFetchResult> = fetchWithOptionalFixture,
): Promise<string | null> {
  try {
    const response = await fetchImpl({
      url: new URL(`https://${apiHostname()}/api/auth.test`),
      method: "POST",
      headers: { authorization: `Bearer ${botToken}` },
      timeoutMs: 10_000,
    });
    const envelope = parseSlackEnvelope(response.bodyText);
    if (!envelope.ok) return null;
    return typeof envelope.team === "string" ? envelope.team : null;
  } catch {
    return null;
  }
}

export function createSlackConnector(
  deps: SlackConnectorDeps = defaultSlackConnectorDeps,
): AuthorityConnector {
  async function botTokenFor(connectionId: string): Promise<string> {
    const token = await deps.resolveSecret(connectionId, "bearer_token");
    if (!token) throw new Error("CREDENTIAL_NOT_CONFIGURED");
    return token;
  }

  async function call(
    connectionId: string,
    plan: SlackRequestPlan,
    options: { signal?: AbortSignal } = {},
  ): Promise<{ response: SafeFetchResult; envelope: SlackEnvelope }> {
    const token = await botTokenFor(connectionId);
    const url = new URL(`https://${apiHostname()}${plan.path}`);
    const response = await deps.fetch({
      url,
      method: plan.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(plan.body ? { "content-type": "application/json; charset=utf-8" } : {}),
      },
      body: plan.body ? JSON.stringify(plan.body) : undefined,
      timeoutMs: 10_000,
      signal: options.signal,
    });
    return { response, envelope: parseSlackEnvelope(response.bodyText) };
  }

  return {
    id: SLACK_CONNECTOR_ID,

    // The trusted Slack operations live in the static registry
    // (src/lib/registry/fixtures/github-demo.ts) -- this list is informational
    // only, kept in sync by hand (see ../stripe/connector.ts's own comment).
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
        return { status: "not_configured", reasons: ["BOT_TOKEN_NOT_CONFIGURED"], lastVerifiedAt: null };
      }
      if (connection.status !== "active") {
        return { status: "suspended", reasons: [], lastVerifiedAt: connection.lastVerifiedAt };
      }
      try {
        const { response, envelope } = await call(context.connectionId, {
          method: "POST",
          path: "/api/auth.test",
          resource: "workspace",
        });
        if (
          response.status === 401 ||
          envelope.error === "invalid_auth" ||
          envelope.error === "token_revoked"
        ) {
          return {
            status: "permission_drift",
            reasons: ["PERMISSION_MISSING:bot_token"],
            lastVerifiedAt: connection.lastVerifiedAt,
          };
        }
        if (!envelope.ok) {
          return {
            status: "permission_drift",
            reasons: [`SLACK_ERROR:${envelope.error ?? "unknown"}`],
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
      return { tool: `${SLACK_CONNECTOR_ID}.${slug}`, operation: tool, resource: plan.resource, args };
    },

    async execute(
      request: NormalizedConnectorRequest,
      context: ConnectorExecutionContext,
    ): Promise<ConnectorExecutionResult> {
      const slug = splitTool(request.operation);
      const plan = planRequest(slug, request.args);

      const isWrite = slug === "post_message";
      if (isWrite) context.beforeWrite();

      const { response, envelope } = await call(context.connectionId, plan, { signal: context.signal });
      const httpStatusClass = Math.floor(response.status / 100);
      if (httpStatusClass !== 2 || !envelope.ok) {
        // connector_execution_receipts.reason_code is constrained to
        // ^[A-Z_]{1,60}$ (no digits, no lowercase) -- Slack's own error
        // strings are lowercase snake_case, so they are upper-cased and
        // scrubbed of anything else (e.g. a raw HTTP status's digits) rather
        // than passed through, which would otherwise crash settlement with a
        // check-constraint violation instead of recording a clean failure.
        const reason = (envelope.error ?? "UNKNOWN_RESPONSE").toUpperCase().replace(/[^A-Z_]/g, "_");
        throw new Error(`SLACK_ERROR_${reason}`);
      }

      return {
        category: "succeeded",
        resourceIds: { resource: plan.resource },
        providerRequestId: typeof envelope.ts === "string" ? envelope.ts : null,
        httpStatusClass,
        agentPayload: envelope as unknown as Record<string, unknown>,
        redaction: {},
      };
    },

    async reconcile(execution: IndeterminateExecution): Promise<ReconciliationResult> {
      // Slack's chat.postMessage has no safe, idempotent "did this already
      // happen" lookup this connector can call without the original message
      // text to match against (which this interface does not carry through
      // to reconcile -- see ../stripe/connector.ts's own comment on the same
      // limitation). An indeterminate post always resolves manually.
      void execution;
      return { outcome: "still_unknown", detail: "Slack reconciliation is not yet implemented." };
    },
  };
}

export const slackConnector: AuthorityConnector = createSlackConnector();
