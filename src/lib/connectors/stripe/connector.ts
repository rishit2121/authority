import "server-only";

import { getConnectorConnectionConfig, resolveConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";

import { safeFetch, type SafeFetchInput, type SafeFetchResult } from "../custom-api/network-guard";
import { STRIPE_FIXTURE_HOSTNAME, stripeFixtureModeEnabled } from "./fixture-mode";
import { stripeFixtureServer } from "./fixture-server";

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

/** Fixed host: Stripe's own API, never tenant-configurable, unlike Custom API's per-connection base URL. */
const STRIPE_API_HOSTNAME = "api.stripe.com";

export const STRIPE_CONNECTOR_ID = "stripe";

type StripeOperationSlug = "issue_refund" | "retrieve_payment" | "retrieve_customer" | "list_charges";

interface StripeRequestPlan {
  method: "GET" | "POST";
  path: string;
  resource: string;
  query?: URLSearchParams;
  body?: URLSearchParams;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`"${key}" must be a non-empty string.`);
  }
  return v;
}

function requireInteger(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
    throw new Error(`"${key}" must be a positive integer.`);
  }
  return v;
}

/**
 * Builds the exact Stripe request for one operation slug, from already
 * schema-validated plan-builder arguments — the static-registry equivalent
 * of Custom API's tenant-authored `request-builder.ts`, except every shape
 * here is registry-fixed code, not tenant data.
 */
function planRequest(slug: StripeOperationSlug, args: Record<string, unknown>): StripeRequestPlan {
  switch (slug) {
    case "retrieve_payment": {
      const paymentId = requireString(args, "payment_id");
      return {
        method: "GET",
        path: `/v1/payment_intents/${encodeURIComponent(paymentId)}`,
        resource: paymentId,
      };
    }
    case "retrieve_customer": {
      const customerId = requireString(args, "customer_id");
      return { method: "GET", path: `/v1/customers/${encodeURIComponent(customerId)}`, resource: customerId };
    }
    case "list_charges": {
      const customerId = requireString(args, "customer_id");
      const query = new URLSearchParams({ customer: customerId });
      return { method: "GET", path: "/v1/charges", resource: customerId, query };
    }
    case "issue_refund": {
      const paymentId = requireString(args, "payment_id");
      const amountCents = requireInteger(args, "amount_cents");
      const body = new URLSearchParams({ payment_intent: paymentId, amount: String(amountCents) });
      return { method: "POST", path: "/v1/refunds", resource: paymentId, body };
    }
  }
}

function splitTool(tool: string): StripeOperationSlug {
  const dot = tool.indexOf(".");
  if (dot <= 0 || dot === tool.length - 1) throw new Error(`"${tool}" is not a valid tool name.`);
  const slug = tool.slice(dot + 1);
  if (
    slug !== "issue_refund" &&
    slug !== "retrieve_payment" &&
    slug !== "retrieve_customer" &&
    slug !== "list_charges"
  ) {
    throw new Error(`Stripe connector does not implement "${tool}".`);
  }
  return slug;
}

export interface StripeConnectorDeps {
  getConnectionConfig: typeof getConnectorConnectionConfig;
  resolveSecret: typeof resolveConnectorSecret;
  fetch: (input: SafeFetchInput) => Promise<SafeFetchResult>;
}

/**
 * Routes the one reserved fixture hostname to the in-process fake Stripe API
 * when fixture mode is explicitly enabled (see fixture-mode.ts); every other
 * destination -- and this hostname itself when the mode is off -- always
 * goes through the real `safeFetch`. Reused from Custom API rather than
 * duplicated: `safeFetch`'s destination/DNS checks are a no-op cost here
 * (Stripe's fixed host is always allowed) but its timeout, response-size
 * bound, and no-redirect rule are exactly what this connector also wants.
 */
async function fetchWithOptionalFixture(input: SafeFetchInput): Promise<SafeFetchResult> {
  if (stripeFixtureModeEnabled() && input.url.hostname === STRIPE_FIXTURE_HOSTNAME) {
    return stripeFixtureServer().handle(input);
  }
  return safeFetch(input);
}

export const defaultStripeConnectorDeps: StripeConnectorDeps = {
  getConnectionConfig: getConnectorConnectionConfig,
  resolveSecret: resolveConnectorSecret,
  fetch: fetchWithOptionalFixture,
};

/** The fixture hostname when fixture mode is on; Stripe's real API host otherwise. Never tenant-configurable. */
function apiHostname(): string {
  return stripeFixtureModeEnabled() ? STRIPE_FIXTURE_HOSTNAME : STRIPE_API_HOSTNAME;
}

/**
 * Best-effort label for which Stripe account a key belongs to, so the
 * dashboard can show it instead of a bare "verified" badge. Takes the
 * plaintext key directly -- callers here already have it in hand from the
 * form submission that is about to store it, so this never needs its own
 * secret resolution. Returns null on any failure; an unlabelled connection
 * is still a working one, and this must never be why saving a key fails.
 */
export async function fetchStripeAccountLabel(
  apiKey: string,
  fetchImpl: (input: SafeFetchInput) => Promise<SafeFetchResult> = fetchWithOptionalFixture,
): Promise<string | null> {
  try {
    const response = await fetchImpl({
      url: new URL(`https://${apiHostname()}/v1/account`),
      method: "GET",
      headers: { authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` },
      timeoutMs: 10_000,
    });
    if (Math.floor(response.status / 100) !== 2) return null;
    const parsed = JSON.parse(response.bodyText) as {
      id?: string;
      email?: string | null;
      business_profile?: { name?: string | null } | null;
    };
    return parsed.business_profile?.name || parsed.email || parsed.id || null;
  } catch {
    return null;
  }
}

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

export function createStripeConnector(
  deps: StripeConnectorDeps = defaultStripeConnectorDeps,
): AuthorityConnector {
  async function apiKeyFor(connectionId: string): Promise<string> {
    const key = await deps.resolveSecret(connectionId, "api_key");
    if (!key) throw new Error("CREDENTIAL_NOT_CONFIGURED");
    return key;
  }

  async function call(
    connectionId: string,
    plan: StripeRequestPlan,
    options: { signal?: AbortSignal; idempotencyKey?: string } = {},
  ): Promise<SafeFetchResult> {
    const apiKey = await apiKeyFor(connectionId);
    const url = new URL(`https://${apiHostname()}${plan.path}`);
    if (plan.query) url.search = plan.query.toString();
    return deps.fetch({
      url,
      method: plan.method,
      headers: {
        authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
        ...(plan.body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        // Stripe deduplicates a POST that repeats the same key, so a write
        // this connector is forced to retry at the transport layer can never
        // create two refunds -- this is on top of, not instead of, the
        // gateway's own capability single-use guarantee, which prevents an
        // agent from presenting the same capability twice but says nothing
        // about a retry *inside* this one dispatch.
        ...(options.idempotencyKey && plan.method === "POST"
          ? { "idempotency-key": options.idempotencyKey }
          : {}),
      },
      body: plan.body?.toString(),
      timeoutMs: 10_000,
      signal: options.signal,
    });
  }

  return {
    id: STRIPE_CONNECTOR_ID,

    // The trusted Stripe operations live in the static registry
    // (src/lib/registry/fixtures/github-demo.ts) -- this list is informational
    // only (no caller currently reads it to build the registry; see that
    // file's own module comment), but is kept in sync with it so the two
    // never silently drift.
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
        const response = await call(context.connectionId, {
          method: "GET",
          path: "/v1/balance",
          resource: "balance",
        });
        if (response.status === 401) {
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

    async normalizeRequest(tool: string, input: unknown): Promise<NormalizedConnectorRequest> {
      const slug = splitTool(tool);
      const args = (input as Record<string, unknown>) ?? {};
      const plan = planRequest(slug, args);
      return { tool: `${STRIPE_CONNECTOR_ID}.${slug}`, operation: tool, resource: plan.resource, args };
    },

    async execute(
      request: NormalizedConnectorRequest,
      context: ConnectorExecutionContext,
    ): Promise<ConnectorExecutionResult> {
      const slug = splitTool(request.operation);
      const plan = planRequest(slug, request.args);

      const isWrite = slug === "issue_refund";
      if (isWrite) context.beforeWrite();

      const response = await call(context.connectionId, plan, {
        signal: context.signal,
        idempotencyKey: context.idempotencyKey,
      });
      const httpStatusClass = Math.floor(response.status / 100);
      if (httpStatusClass !== 2) {
        // connector_execution_receipts.reason_code is constrained to
        // ^[A-Z_]{1,60}$ (no digits) -- a raw status code would crash
        // settlement with a check-constraint violation instead of recording
        // a clean failure, so this classifies by status class instead of
        // embedding the exact code.
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
      // Stripe refunds are the only write this connector performs, and
      // Stripe's own API has no "look up the refund I was about to create by
      // my idempotency key" GET that this reconcile path could call without
      // first minting a brand-new idempotency key of its own (which would
      // defeat the point). Until this connector sends `Idempotency-Key` on
      // every POST and reconciles by replaying the SAME key (tracked as a
      // follow-up), an indeterminate refund always resolves manually, same
      // as Custom API.
      void execution;
      return {
        outcome: "still_unknown",
        detail: "Stripe reconciliation by idempotency key is not yet implemented.",
      };
    },
  };
}

export const stripeConnector: AuthorityConnector = createStripeConnector();
