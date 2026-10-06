import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createStripeConnector, defaultStripeConnectorDeps } from "@/lib/connectors/stripe/connector";
import { registerConnector, resetConnectorRegistryForTests } from "@/lib/connectors/registry";

import { StripeFixtureApi } from "../connectors/stripe-fixture-provider";
import {
  ADMIN_A_USER_ID,
  closeGatewayPool,
  createStripeConnection,
  setStripeApiKey,
  TENANT_A_ID,
  type StripeConnectionFixture,
} from "../connectors/stripe-support";
import { createGatewayFixture, type GatewayFixture } from "../gateway-support";
import { managementQuery } from "../support";

/**
 * Exercises the real wire protocol through the actual route handler
 * (src/app/api/mcp/tasks/[taskId]/route.ts), not just the bridge functions
 * it calls -- proving the McpServer/WebStandardStreamableHTTPServerTransport
 * wiring itself works: initialize, tools/list, and tools/call over real
 * JSON-RPC request/response bodies.
 */
describe("MCP route (real wire protocol, fixture Stripe connector)", () => {
  let connection: StripeConnectionFixture;
  let fixtureApi: StripeFixtureApi;
  let fx: GatewayFixture;

  beforeAll(async () => {
    fixtureApi = new StripeFixtureApi();
    fixtureApi.requiredApiKey = "sk_test_route_fixture";
    resetConnectorRegistryForTests();
    registerConnector(createStripeConnector({ ...defaultStripeConnectorDeps, fetch: fixtureApi.fetch }));

    connection = await createStripeConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "route-stripe",
    });
    await setStripeApiKey(connection, "sk_test_route_fixture");

    fx = await createGatewayFixture({
      label: "mcp-route",
      actions: JSON.stringify({
        schemaVersion: 1,
        items: [{ tool: "stripe.retrieve_payment", constraints: [] }],
      }),
      // "tenant", not `true`: the MCP bridge authorizes through
      // buildTenantRegistry(tenantId) internally (src/lib/mcp/bridge.ts),
      // not the bare fixture file -- the contract must match that.
      useCurrentVersions: "tenant",
    });
  }, 60_000);

  afterAll(async () => {
    await managementQuery(`
      set local role postgres;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.connector_execution_receipts where task_id = '${fx.taskId}';
      delete from public.connector_reservations where task_id = '${fx.taskId}';
      delete from public.task_connector_bindings where task_id = '${fx.taskId}';
    `);
    await fx.cleanup();
    await connection?.cleanup();
    resetConnectorRegistryForTests();
    await closeGatewayPool();
  }, 30_000);

  async function post(
    body: unknown,
    sessionId?: string,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const { POST } = await import("@/app/api/mcp/tasks/[taskId]/route");
    const request = new Request(`http://localhost/api/mcp/tasks/${fx.taskId}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${fx.secret}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(body),
    });
    const response = await POST(request as never, { params: Promise.resolve({ taskId: fx.taskId }) });
    const text = await response.text();
    // enableJsonResponse: true (see the route) means a plain JSON body, not an SSE stream.
    const payload = text.startsWith("event:") ? text.split("data: ")[1]?.split("\n")[0] : text;
    return { status: response.status, json: payload ? (JSON.parse(payload) as Record<string, unknown>) : {} };
  }

  it("rejects a request with no bearer credential before touching the MCP transport at all", async () => {
    const { POST } = await import("@/app/api/mcp/tasks/[taskId]/route");
    const request = new Request(`http://localhost/api/mcp/tasks/${fx.taskId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    const response = await POST(request as never, { params: Promise.resolve({ taskId: fx.taskId }) });
    expect(response.status).toBe(401);
  });

  it("rejects an unknown task id with a clean 404, never a crash", async () => {
    const { POST } = await import("@/app/api/mcp/tasks/[taskId]/route");
    const unknownTaskId = "00000000-0000-4000-8000-000000000000";
    const request = new Request(`http://localhost/api/mcp/tasks/${unknownTaskId}`, {
      method: "POST",
      headers: { authorization: `Bearer ${fx.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    const response = await POST(request as never, { params: Promise.resolve({ taskId: unknownTaskId }) });
    expect(response.status).toBe(404);
  });

  it("initializes, lists the one allowed tool, and calls it successfully over real JSON-RPC", async () => {
    const init = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });
    expect(init.status).toBe(200);
    expect(init.json.result).toMatchObject({ serverInfo: { name: "authority" } });

    const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(list.status).toBe(200);
    const result = list.json.result as { tools?: Array<{ name: string }> };
    expect(result.tools?.map((t) => t.name)).toEqual(["stripe.retrieve_payment"]);

    const call = await post({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "stripe.retrieve_payment", arguments: { payment_id: "pi_1demo" } },
    });
    expect(call.status).toBe(200);
    const callResult = call.json.result as { isError?: boolean; content?: Array<{ text?: string }> };
    expect(callResult.isError).toBe(false);
    const text = callResult.content?.[0]?.text ?? "";
    expect(JSON.parse(text)).toMatchObject({ summary: "Succeeded." });
  });
});
