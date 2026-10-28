import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createStripeConnector, defaultStripeConnectorDeps } from "@/lib/connectors/stripe/connector";
import { registerConnector, resetConnectorRegistryForTests } from "@/lib/connectors/registry";
import { authorizeAndExecuteMcpTool, buildMcpToolCatalog } from "@/lib/mcp/bridge";

import { createGatewayFixture, type GatewayFixture } from "../gateway-support";
import { managementQuery } from "../support";
import { StripeFixtureApi } from "../connectors/stripe-fixture-provider";
import {
  ADMIN_A_USER_ID,
  closeGatewayPool,
  createStripeConnection,
  setStripeApiKey,
  TENANT_A_ID,
  type StripeConnectionFixture,
} from "../connectors/stripe-support";

/**
 * Proves the MCP bridge (src/lib/mcp/bridge.ts) is a thin, faithful
 * translation of Authority's real authorize+execute pipeline -- not a
 * separate trust path. Reuses the Stripe connector's own fixture
 * infrastructure (stripe-connector.test.ts) rather than re-deriving a new
 * connector setup: the point of this suite is proving the BRIDGE's wiring
 * (catalog construction, resource derivation, authorize-then-execute),
 * which is independent of which connector sits behind it.
 */

describe("MCP bridge (real database, fixture Stripe connector)", () => {
  let connection: StripeConnectionFixture;
  let fixtureApi: StripeFixtureApi;
  const fixtures: GatewayFixture[] = [];
  const API_KEY = "sk_test_mcp_fixture";

  const mkTask = async (label: string, tools: string[]) => {
    const fx = await createGatewayFixture({
      label,
      actions: JSON.stringify({ schemaVersion: 1, items: tools.map((tool) => ({ tool, constraints: [] })) }),
      // "tenant", not `true`: the MCP bridge authorizes through
      // buildTenantRegistry(tenantId) internally (src/lib/mcp/bridge.ts),
      // not the bare fixture file -- the contract must match that.
      useCurrentVersions: "tenant",
    });
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
      label: "mcp-stripe",
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

  it("buildMcpToolCatalog lists exactly the contract's allowed tool, with its real registry schema", async () => {
    const fx = await mkTask("catalog", ["stripe.retrieve_payment"]);
    const catalog = await buildMcpToolCatalog(fx.taskId);
    expect(catalog.status).toBe("ok");
    expect(catalog.tools.map((t) => t.name)).toEqual(["stripe.retrieve_payment"]);
    expect(catalog.tools[0].inputSchema.shape.payment_id).toBeDefined();
  });

  it("returns task_not_found for an unknown task id", async () => {
    const catalog = await buildMcpToolCatalog("00000000-0000-4000-8000-000000000000");
    expect(catalog.status).toBe("task_not_found");
  });

  it("authorizeAndExecuteMcpTool runs the allowed call end to end against the fixture Stripe API", async () => {
    const fx = await mkTask("call-allowed", ["stripe.retrieve_payment"]);
    const catalog = await buildMcpToolCatalog(fx.taskId);
    const tool = catalog.tools[0];
    const result = await authorizeAndExecuteMcpTool({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tool: tool.name,
      operation: tool.operation,
      args: { payment_id: "pi_1demo" },
    });
    expect(result.success).toBe(true);
    expect(result.body.data).toMatchObject({ id: "pi_1demo", status: "succeeded" });
  });

  it("derives the resource from the identifiesResource field and rejects a call missing it", async () => {
    const fx = await mkTask("call-missing-resource", ["stripe.retrieve_payment"]);
    const catalog = await buildMcpToolCatalog(fx.taskId);
    const tool = catalog.tools[0];
    const before = fixtureApi.requests.length;
    const result = await authorizeAndExecuteMcpTool({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tool: tool.name,
      operation: tool.operation,
      args: {},
    });
    expect(result.success).toBe(false);
    expect(result.body.error).toMatchObject({ code: "ARGUMENT_MISSING" });
    expect(fixtureApi.requests.length).toBe(before); // never dispatched
  });

  it("rejects a tool call the contract never allowed, never minting a capability", async () => {
    const fx = await mkTask("call-not-allowed", ["stripe.retrieve_payment"]);
    const catalog = await buildMcpToolCatalog(fx.taskId);
    const allowedTool = catalog.tools[0];
    const before = fixtureApi.requests.length;
    const result = await authorizeAndExecuteMcpTool({
      credentialSecret: fx.secret,
      taskId: fx.taskId,
      tool: "stripe.issue_refund",
      operation: { ...allowedTool.operation, id: "stripe.issue_refund" },
      args: { payment_id: "pi_1demo", amount_cents: 500 },
    });
    expect(result.success).toBe(false);
    expect(fixtureApi.requests.length).toBe(before);
  });

  it("rejects a bad credential before touching the fixture API", async () => {
    const fx = await mkTask("bad-credential", ["stripe.retrieve_payment"]);
    const catalog = await buildMcpToolCatalog(fx.taskId);
    const tool = catalog.tools[0];
    const before = fixtureApi.requests.length;
    const result = await authorizeAndExecuteMcpTool({
      credentialSecret: "not-a-real-credential",
      taskId: fx.taskId,
      tool: tool.name,
      operation: tool.operation,
      args: { payment_id: "pi_1demo" },
    });
    expect(result.success).toBe(false);
    expect(fixtureApi.requests.length).toBe(before);
  });
});
