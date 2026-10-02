import type { SafeFetchInput, SafeFetchResult } from "@/lib/connectors/custom-api/network-guard";

/**
 * A local, in-memory fixture API standing in for the real Stripe API --
 * the Stripe connector equivalent of Custom API's `WidgetOrdersFixtureApi`
 * (./custom-api-fixture-provider.ts) and GitHub's `mockGithub`. Injected as
 * the connector's own `fetch` dependency (`StripeConnectorDeps.fetch`),
 * never a real socket. One instance per test, unlike the dev-server's
 * process-wide `stripeFixtureServer()` singleton, so tests never share
 * mutable state with each other.
 *
 * Exercises the exact same request shape the real connector builds (method,
 * URL, headers, body) and the exact same `SafeFetchResult` contract
 * `safeFetch` would hand back from a real socket, so everything upstream of
 * the network call -- auth header construction, response parsing,
 * settlement -- runs unmodified.
 */
export interface FixturePaymentIntent {
  id: string;
  amount: number;
  currency: string;
  customer: string;
  status: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | null;
  idempotencyKey: string | null;
}

export class StripeFixtureApi {
  readonly paymentIntents = new Map<string, FixturePaymentIntent>([
    [
      "pi_1demo",
      { id: "pi_1demo", amount: 4200, currency: "usd", customer: "cus_1demo", status: "succeeded" },
    ],
  ]);
  readonly customers = new Map<string, { id: string; email: string; name: string }>([
    ["cus_1demo", { id: "cus_1demo", email: "demo@example.com", name: "Demo Customer" }],
  ]);
  readonly charges = [
    { id: "ch_1demo", amount: 4200, currency: "usd", customer: "cus_1demo", payment_intent: "pi_1demo" },
  ];
  readonly refunds: Array<{ id: string; payment_intent: string; amount: number }> = [];
  readonly requests: RecordedRequest[] = [];
  requiredApiKey: string | null = null;

  /** Matches `StripeConnectorDeps["fetch"]` exactly -- drop-in for `safeFetch` in tests. */
  fetch = async (input: SafeFetchInput): Promise<SafeFetchResult> => {
    this.requests.push({
      method: input.method,
      path: input.url.pathname,
      authorization: input.headers.authorization ?? null,
      idempotencyKey: input.headers["idempotency-key"] ?? null,
    });

    if (this.requiredApiKey) {
      const expected = `Basic ${Buffer.from(`${this.requiredApiKey}:`).toString("base64")}`;
      if (input.headers.authorization !== expected) {
        return jsonResponse(401, { error: { code: "api_key_invalid", message: "Invalid API Key provided" } });
      }
    }

    const piMatch = /^\/v1\/payment_intents\/([^/]+)$/.exec(input.url.pathname);
    if (input.method === "GET" && piMatch) {
      const pi = this.paymentIntents.get(piMatch[1]);
      return pi ? jsonResponse(200, pi) : jsonResponse(404, { error: { code: "resource_missing" } });
    }

    const customerMatch = /^\/v1\/customers\/([^/]+)$/.exec(input.url.pathname);
    if (input.method === "GET" && customerMatch) {
      const customer = this.customers.get(customerMatch[1]);
      return customer
        ? jsonResponse(200, customer)
        : jsonResponse(404, { error: { code: "resource_missing" } });
    }

    if (input.method === "GET" && input.url.pathname === "/v1/charges") {
      const customerId = input.url.searchParams.get("customer");
      const data = this.charges.filter((c) => !customerId || c.customer === customerId);
      return jsonResponse(200, { object: "list", data, has_more: false });
    }

    if (input.method === "POST" && input.url.pathname === "/v1/refunds") {
      const params = new URLSearchParams(input.body ?? "");
      const paymentIntentId = params.get("payment_intent");
      if (!paymentIntentId) return jsonResponse(400, { error: { code: "parameter_missing" } });
      const pi = this.paymentIntents.get(paymentIntentId);
      if (!pi) return jsonResponse(404, { error: { code: "resource_missing" } });
      const amount = Number(params.get("amount") ?? pi.amount);
      const refund = { id: `re_${this.refunds.length + 1}demo`, payment_intent: paymentIntentId, amount };
      this.refunds.push(refund);
      return jsonResponse(200, { ...refund, status: "succeeded", currency: pi.currency });
    }

    return jsonResponse(404, {
      error: { code: "resource_missing", message: "no such route on the fixture API" },
    });
  };
}

function jsonResponse(status: number, body: unknown): SafeFetchResult {
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    bodyText: JSON.stringify(body),
    truncated: false,
  };
}
