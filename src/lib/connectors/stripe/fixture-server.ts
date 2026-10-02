import "server-only";

import type { SafeFetchInput, SafeFetchResult } from "../custom-api/network-guard";

/**
 * The in-process fake Stripe API, reachable only at `STRIPE_FIXTURE_HOSTNAME`
 * and only when `stripeFixtureModeEnabled()` is true (see fixture-mode.ts).
 * Used for local development and the e2e suite's proof that the real
 * connector's request-building, auth, response-parsing, and settlement code
 * all run unmodified against something that looks exactly like Stripe's own
 * REST shape -- the Stripe equivalent of Custom API's
 * `WidgetOrdersFixtureServer` (../custom-api/fixture-server.ts).
 */
export interface FixturePaymentIntent {
  id: string;
  amount: number;
  currency: string;
  customer: string;
  status: string;
}

export interface FixtureCustomer {
  id: string;
  email: string;
  name: string;
}

export interface FixtureCharge {
  id: string;
  amount: number;
  currency: string;
  customer: string;
  payment_intent: string;
}

export interface FixtureRequestLogEntry {
  method: string;
  path: string;
  authorization: string | null;
  at: string;
}

function initialPaymentIntents(): Array<[string, FixturePaymentIntent]> {
  return [
    [
      "pi_1demo",
      { id: "pi_1demo", amount: 4200, currency: "usd", customer: "cus_1demo", status: "succeeded" },
    ],
  ];
}

function initialCustomers(): Array<[string, FixtureCustomer]> {
  return [["cus_1demo", { id: "cus_1demo", email: "demo@example.com", name: "Demo Customer" }]];
}

function initialCharges(): Array<[string, FixtureCharge]> {
  return [
    [
      "ch_1demo",
      { id: "ch_1demo", amount: 4200, currency: "usd", customer: "cus_1demo", payment_intent: "pi_1demo" },
    ],
  ];
}

class StripeFixtureServer {
  paymentIntents = new Map<string, FixturePaymentIntent>(initialPaymentIntents());
  customers = new Map<string, FixtureCustomer>(initialCustomers());
  charges = new Map<string, FixtureCharge>(initialCharges());
  refunds: Array<{ id: string; payment_intent: string; amount: number }> = [];
  requestLog: FixtureRequestLogEntry[] = [];

  reset(): void {
    this.paymentIntents = new Map(initialPaymentIntents());
    this.customers = new Map(initialCustomers());
    this.charges = new Map(initialCharges());
    this.refunds = [];
    this.requestLog = [];
  }

  handle = async (input: SafeFetchInput): Promise<SafeFetchResult> => {
    this.requestLog.push({
      method: input.method,
      path: input.url.pathname,
      authorization: input.headers.authorization ?? null,
      at: new Date().toISOString(),
    });

    const piMatch = /^\/v1\/payment_intents\/([^/]+)$/.exec(input.url.pathname);
    if (input.method === "GET" && piMatch) {
      const pi = this.paymentIntents.get(piMatch[1]);
      return pi ? json(200, pi) : stripeError(404, "resource_missing", "No such payment_intent");
    }

    const customerMatch = /^\/v1\/customers\/([^/]+)$/.exec(input.url.pathname);
    if (input.method === "GET" && customerMatch) {
      const customer = this.customers.get(customerMatch[1]);
      return customer ? json(200, customer) : stripeError(404, "resource_missing", "No such customer");
    }

    if (input.method === "GET" && input.url.pathname === "/v1/charges") {
      const customerId = input.url.searchParams.get("customer");
      const data = Array.from(this.charges.values()).filter((c) => !customerId || c.customer === customerId);
      return json(200, { object: "list", data, has_more: false });
    }

    if (input.method === "POST" && input.url.pathname === "/v1/refunds") {
      const params = new URLSearchParams(input.body ?? "");
      const paymentIntentId = params.get("payment_intent");
      if (!paymentIntentId)
        return stripeError(400, "parameter_missing", "Missing required param: payment_intent");
      const pi = this.paymentIntents.get(paymentIntentId);
      if (!pi) return stripeError(404, "resource_missing", "No such payment_intent");
      const amount = Number(params.get("amount") ?? pi.amount);
      const refund = { id: `re_${this.refunds.length + 1}demo`, payment_intent: paymentIntentId, amount };
      this.refunds.push(refund);
      return json(200, { ...refund, status: "succeeded", currency: pi.currency });
    }

    return stripeError(404, "resource_missing", "no such route on the fixture API");
  };
}

function json(status: number, body: unknown): SafeFetchResult {
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    bodyText: JSON.stringify(body),
    truncated: false,
  };
}

function stripeError(status: number, code: string, message: string): SafeFetchResult {
  return json(status, { error: { code, message, type: "invalid_request_error" } });
}

const globalForFixture = globalThis as unknown as { __stripeFixtureServer?: StripeFixtureServer };

export function stripeFixtureServer(): StripeFixtureServer {
  if (!globalForFixture.__stripeFixtureServer) {
    globalForFixture.__stripeFixtureServer = new StripeFixtureServer();
  }
  return globalForFixture.__stripeFixtureServer;
}
