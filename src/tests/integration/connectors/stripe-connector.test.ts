import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createStripeConnector, defaultStripeConnectorDeps } from "@/lib/connectors/stripe/connector";
import { defaultConnectorExecutorDeps, executeConnectorOperation } from "@/lib/connectors/executor";
import { registerConnector, resetConnectorRegistryForTests } from "@/lib/connectors/registry";
import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";

import { createGatewayFixture, currentVersions, type GatewayFixture } from "../gateway-support";
import { managementQuery } from "../support";
import { StripeFixtureApi } from "./stripe-fixture-provider";
import {
  ADMIN_A_USER_ID,
  TENANT_A_ID,
  closeGatewayPool,
  createStripeConnection,
  disconnectStripeConnection,
  setStripeApiKey,
  type StripeConnectionFixture,
} from "./stripe-support";

/**
 * The Stripe connector against the real database (reserve -> dispatch ->
 * settle, real two-phase gateway RPCs), with the one outbound HTTP call
 * replaced by an in-memory fixture API (see stripe-fixture-provider.ts) --
 * the same relationship custom-api-connector.test.ts has to
 * WidgetOrdersFixtureApi, and github-connector.test.ts has to mockGithub.
 *
 * Unlike Custom API, Stripe's operations are static registry entries and its
 * connector_id is the fixed string "stripe" (not per-connection dynamic), so
 * there is no "wrong connector id" cross-tenant case to exercise here --
 * tenant isolation is enforced by `resolve_credential` alone, already
 * covered by the gateway's own cross-tenant tests. What is Stripe-specific:
 * wrong-operation substitution, concurrent consumption, revocation,
 * indeterminate refunds, and that a refund carries an idempotency key.
 */

let seq = 0;
const key = (p: string) => `${p}-${Date.now()}-${++seq}`;

async function authorize(
  fx: GatewayFixture,
  tool: string,
  args: Record<string, string | number | boolean>,
  resource: string,
  maxUses = 1,
) {
  const r = await authorizeThroughGateway({
    credentialSecret: fx.secret,
    taskId: fx.taskId,
    tool,
    operation: tool.split(".").slice(1).join("."),
    resource,
    arguments: args,
    idempotencyKey: key("auth"),
    maxUses,
    ...currentVersions(),
  });
  if (r.kind !== "decision" || !r.capabilityToken) {
    throw new Error(
      `no capability for ${tool}: ${JSON.stringify(r.kind === "decision" ? r.commit.reasonCodes : r.status)}`,
    );
  }
  return r.capabilityToken;
}

function run(
  fx: GatewayFixture,
  token: string,
  tool: string,
  args: Record<string, string | number | boolean>,
  resource: string,
  idem = key("exec"),
) {
  return executeConnectorOperation(
    {
      credentialSecret: fx.secret,
      tokenHash: hashCapabilityToken(token),
      tool,
      operation: tool.split(".").slice(1).join("."),
      resource,
      args,
      idempotencyKey: idem,
    },
    defaultConnectorExecutorDeps,
  );
}

const actionsFor = (tools: string[]) =>
  JSON.stringify({ schemaVersion: 1, items: tools.map((tool) => ({ tool, constraints: [] })) });

describe("Stripe connector (in-memory fixture API, real database)", () => {
  let connection: StripeConnectionFixture;
  let fixtureApi: StripeFixtureApi;
  const fixtures: GatewayFixture[] = [];
  const API_KEY = "sk_test_fixture_7a1c";

  const mkTask = async (label: string, tools: string[]) => {
    const fx = await createGatewayFixture({ label, actions: actionsFor(tools), useCurrentVersions: true });
    fixtures.push(fx);
    return fx;
  };

  beforeAll(async () => {
    fixtureApi = new StripeFixtureApi();
    fixtureApi.requiredApiKey = API_KEY;

    resetConnectorRegistryForTests();
    registerConnector(createStripeConnector({ ...defaultStripeConnectorDeps, fetch: fixtureApi.fetch }));

    connection = await createStripeConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "stripe-test",
    });
    await setStripeApiKey(connection, API_KEY);
  }, 60_000);

  afterEach(async () => {
    while (fixtures.length > 0) {
      const fx = fixtures.pop();
      if (!fx) continue;
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.connector_execution_receipts where task_id = '${fx.taskId}';
        delete from public.connector_reservations where task_id = '${fx.taskId}';
        delete from public.task_connector_bindings where task_id = '${fx.taskId}';
      `);
      await fx.cleanup();
    }
  });

  afterAll(async () => {
    await connection?.cleanup();
    resetConnectorRegistryForTests();
    await closeGatewayPool();
  }, 30_000);

  it("the allowed request: a correctly scoped capability executes against the fixture API and returns its payload", async () => {
    const fx = await mkTask("allowed", ["stripe.retrieve_payment"]);
    const token = await authorize(fx, "stripe.retrieve_payment", { payment_id: "pi_1demo" }, "pi_1demo");
    const result = await run(fx, token, "stripe.retrieve_payment", { payment_id: "pi_1demo" }, "pi_1demo");
    expect(result.http).toBe(200);
    expect(result.body.data).toMatchObject({ id: "pi_1demo", status: "succeeded" });
    expect(fixtureApi.requests.at(-1)).toMatchObject({
      method: "GET",
      path: "/v1/payment_intents/pi_1demo",
    });
  });

  it("the blocked request: a capability scoped to one payment cannot be replayed against a different one", async () => {
    const fx = await mkTask("blocked-resource", ["stripe.retrieve_payment"]);
    const token = await authorize(fx, "stripe.retrieve_payment", { payment_id: "pi_1demo" }, "pi_1demo");
    const before = fixtureApi.requests.length;
    const result = await run(fx, token, "stripe.retrieve_payment", { payment_id: "pi_other" }, "pi_other");
    expect(result.http).toBe(403);
    expect(result.body.error).toMatchObject({ code: "SCOPE_MISMATCH" });
    expect(fixtureApi.requests.length).toBe(before); // never dispatched
  });

  it("wrong-operation substitution: a capability minted for retrieve_payment cannot be redirected to issue_refund", async () => {
    const fx = await mkTask("wrong-op", ["stripe.retrieve_payment", "stripe.issue_refund"]);
    const token = await authorize(fx, "stripe.retrieve_payment", { payment_id: "pi_1demo" }, "pi_1demo");
    const before = fixtureApi.requests.length;
    const result = await run(
      fx,
      token,
      "stripe.issue_refund",
      { payment_id: "pi_1demo", amount_cents: 500 },
      "pi_1demo",
    );
    expect(result.http).toBe(403);
    expect(result.body.error).toMatchObject({ code: "SCOPE_MISMATCH" });
    expect(fixtureApi.requests.length).toBe(before);
  });

  it("a refund carries an idempotency key, and repeating the same idempotency key never dispatches Stripe twice", async () => {
    const fx = await mkTask("refund-idempotent", ["stripe.issue_refund"]);
    const token = await authorize(
      fx,
      "stripe.issue_refund",
      { payment_id: "pi_1demo", amount_cents: 1000 },
      "pi_1demo",
      1,
    );
    const idem = key("race");
    const [a, b] = await Promise.all([
      run(fx, token, "stripe.issue_refund", { payment_id: "pi_1demo", amount_cents: 1000 }, "pi_1demo", idem),
      run(fx, token, "stripe.issue_refund", { payment_id: "pi_1demo", amount_cents: 1000 }, "pi_1demo", idem),
    ]);
    // Same idempotency key on the same capability: the reservation layer
    // dedupes before either call reaches this connector a second time, so
    // outcomes are either both 200 (the second replayed the first's settled
    // receipt) or one 200 and one 409 EXECUTION_IN_PROGRESS (a genuine race).
    const outcomes = [a.http, b.http].sort();
    expect(outcomes[0]).toBe(200);
    expect([200, 409]).toContain(outcomes[1]);

    const refundRequests = fixtureApi.requests.filter((r) => r.path === "/v1/refunds");
    expect(refundRequests).toHaveLength(1); // Stripe itself was called exactly once
    expect(refundRequests[0]?.idempotencyKey).toBe(idem);
    expect(fixtureApi.refunds).toHaveLength(1);
  });

  it("concurrent consumption: a single-use capability dispatched twice in parallel (different idempotency keys) is honored exactly once", async () => {
    const fx = await mkTask("concurrent", ["stripe.retrieve_payment"]);
    const token = await authorize(fx, "stripe.retrieve_payment", { payment_id: "pi_1demo" }, "pi_1demo", 1);
    const [a, b] = await Promise.all([
      run(fx, token, "stripe.retrieve_payment", { payment_id: "pi_1demo" }, "pi_1demo", key("race")),
      run(fx, token, "stripe.retrieve_payment", { payment_id: "pi_1demo" }, "pi_1demo", key("race")),
    ]);
    const outcomes = [a.http, b.http].sort();
    expect(outcomes[0]).toBe(200);
    expect([403, 409]).toContain(outcomes[1]); // CAPABILITY_ALREADY_USED or a RESERVATION_IN_PROGRESS race loser
    const successes = [a, b].filter((r) => r.http === 200);
    expect(successes).toHaveLength(1);
  });

  it("revocation: disconnecting the connection revokes an already-issued capability before it executes", async () => {
    // A tenant may have only one active Stripe connection at a time
    // (connector_connections_one_active_per_connector), so this test
    // disconnects and recreates the shared one rather than standing up a
    // second connection alongside it.
    const fx = await mkTask("revocation", ["stripe.retrieve_payment"]);
    const token = await authorize(fx, "stripe.retrieve_payment", { payment_id: "pi_1demo" }, "pi_1demo");

    await disconnectStripeConnection(connection, ADMIN_A_USER_ID);
    try {
      const result = await run(fx, token, "stripe.retrieve_payment", { payment_id: "pi_1demo" }, "pi_1demo");
      expect(result.http).not.toBe(200);
      expect((result.body.error as { code?: string } | undefined)?.code).toMatch(
        /REVOKED|CONNECTOR_NOT_CONFIGURED|CONNECTION_UNAVAILABLE/,
      );
    } finally {
      // The just-disconnected connection is no longer used by anything --
      // delete it before replacing `connection`, or it leaks as an orphaned
      // row (with its secret) forever, since afterAll only ever cleans up
      // whichever connection this variable currently points to.
      await connection.cleanup();
      // Reconnect a fresh connection under the shared fixture so later tests
      // in this file still have an active one to resolve against.
      connection = await createStripeConnection({
        tenantId: TENANT_A_ID,
        adminUserId: ADMIN_A_USER_ID,
        label: "stripe-test",
      });
      await setStripeApiKey(connection, API_KEY);
    }
  });

  it("indeterminate writes: a refund whose response never arrives settles as indeterminate, not failed or succeeded", async () => {
    const fx = await mkTask("indeterminate", ["stripe.issue_refund"]);
    const token = await authorize(
      fx,
      "stripe.issue_refund",
      { payment_id: "pi_1demo", amount_cents: 200 },
      "pi_1demo",
    );

    const hangingFetch: typeof fixtureApi.fetch = () => new Promise(() => {}); // never resolves
    resetConnectorRegistryForTests();
    registerConnector(createStripeConnector({ ...defaultStripeConnectorDeps, fetch: hangingFetch }));
    try {
      const result = await executeConnectorOperation(
        {
          credentialSecret: fx.secret,
          tokenHash: hashCapabilityToken(token),
          tool: "stripe.issue_refund",
          operation: "issue_refund",
          resource: "pi_1demo",
          args: { payment_id: "pi_1demo", amount_cents: 200 },
          idempotencyKey: key("exec"),
        },
        { ...defaultConnectorExecutorDeps, deadlineMs: 150 },
      );
      expect(result.http).toBe(504);
      expect(result.body.error).toMatchObject({ code: "EXECUTION_INDETERMINATE" });
      expect(result.body.status).toBe("indeterminate");

      const [row] = (await managementQuery(
        `select result_category from public.connector_execution_receipts where execution_id = '${result.body.executionId}';`,
      )) as Array<{ result_category: string }>;
      expect(row?.result_category).toBe("indeterminate");
    } finally {
      resetConnectorRegistryForTests();
      registerConnector(createStripeConnector({ ...defaultStripeConnectorDeps, fetch: fixtureApi.fetch }));
    }
  });
});
