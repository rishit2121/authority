import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createCustomApiConnector, defaultCustomApiConnectorDeps } from "@/lib/connectors/custom-api/connector";
import { registerConnector, resetConnectorRegistryForTests } from "@/lib/connectors/registry";
import { executeConnectorOperation, defaultConnectorExecutorDeps } from "@/lib/connectors/executor";
import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";

import {
  createGatewayFixture,
  currentVersions,
  type GatewayFixture,
} from "../gateway-support";
import { managementQuery } from "../support";
import {
  ADMIN_A_USER_ID,
  OWNER_B_USER_ID,
  TENANT_A_ID,
  TENANT_B_ID,
  closeGatewayPool,
  createCustomApiConnection,
  disconnectCustomApiConnection,
  publishOperation,
  setBearerSecret,
  type CustomApiConnectionFixture,
  type PublishedOperationFixture,
} from "./custom-api-support";
import { WidgetOrdersFixtureApi } from "./custom-api-fixture-provider";

/**
 * The Custom API connector against the real database (reserve -> dispatch ->
 * settle, real two-phase gateway RPCs, real draft/validate/publish
 * lifecycle), with the one outbound HTTP call replaced by an in-memory
 * fixture API (see custom-api-fixture-provider.ts) -- the same relationship
 * github-connector.test.ts has to mockGithub.
 *
 * Proves exactly what Part 7's review asked for, beyond the unit-level
 * schema/request-builder tests: cross-tenant connection substitution, wrong-
 * operation substitution, concurrent consumption, revocation, and
 * indeterminate writes -- properties that only show up against a real
 * database under real concurrency, not from mocked orchestration tests.
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
    throw new Error(`no capability for ${tool}: ${JSON.stringify(r.kind === "decision" ? r.commit.reasonCodes : r.status)}`);
  }
  return r.capabilityToken;
}

function run(fx: GatewayFixture, token: string, tool: string, args: Record<string, string | number | boolean>, resource: string, idem = key("exec")) {
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

describe("Custom API connector (in-memory fixture API, real database)", () => {
  let connectionA: CustomApiConnectionFixture;
  let connectionB: CustomApiConnectionFixture;
  let getOrder: PublishedOperationFixture;
  let cancelOrder: PublishedOperationFixture;
  let fixtureApi: WidgetOrdersFixtureApi;
  const fixtures: GatewayFixture[] = [];
  const BEARER_TOKEN = "fixture-bearer-7a1c";

  const mkTask = async (label: string, tools: string[]) => {
    const fx = await createGatewayFixture({ label, actions: actionsFor(tools), useCurrentVersions: true });
    fixtures.push(fx);
    return fx;
  };

  beforeAll(async () => {
    fixtureApi = new WidgetOrdersFixtureApi();
    fixtureApi.requiredBearerToken = BEARER_TOKEN;

    resetConnectorRegistryForTests();
    registerConnector(createCustomApiConnector({ ...defaultCustomApiConnectorDeps, fetch: fixtureApi.fetch }));

    connectionA = await createCustomApiConnection({ tenantId: TENANT_A_ID, adminUserId: ADMIN_A_USER_ID, label: "widget-orders-a" });
    connectionB = await createCustomApiConnection({ tenantId: TENANT_B_ID, adminUserId: OWNER_B_USER_ID, label: "widget-orders-b" });

    getOrder = await publishOperation(connectionA, {
      operationSlug: "get_order",
      name: "Get order",
      method: "GET",
      pathTemplate: "/v1/orders/{orderId}",
      effect: "read",
      inputSchema: {
        schemaVersion: 1,
        fields: [{ key: "orderId", type: "string", required: true, identifiesResource: true, in: "path" }],
      },
      authType: "bearer",
    });
    await setBearerSecret(connectionA, BEARER_TOKEN);

    cancelOrder = await publishOperation(connectionA, {
      operationSlug: "cancel_order",
      name: "Cancel order",
      method: "POST",
      pathTemplate: "/v1/orders/{orderId}/cancel",
      effect: "write_update",
      inputSchema: {
        schemaVersion: 1,
        fields: [{ key: "orderId", type: "string", required: true, identifiesResource: true, in: "path" }],
      },
      authType: "none",
    });
  }, 60_000);

  afterEach(async () => {
    while (fixtures.length > 0) {
      const fx = fixtures.pop();
      if (!fx) continue;
      // connector_reservations/connector_execution_receipts/task_connector_bindings
      // reference capability_tokens with a plain foreign key (no cascade, by
      // design -- evidence is never silently deleted alongside its capability
      // in production). Test teardown has to clear them first, same ordering
      // GitHub's own fixture cleanup already uses for capability_reservations.
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
    await connectionA?.cleanup();
    await connectionB?.cleanup();
    resetConnectorRegistryForTests();
    await closeGatewayPool();
  }, 30_000);

  it("the allowed request: a correctly scoped capability executes against the fixture API and returns its payload", async () => {
    const fx = await mkTask("allowed", [getOrder.toolName]);
    const token = await authorize(fx, getOrder.toolName, { orderId: "4821" }, "4821");
    const result = await run(fx, token, getOrder.toolName, { orderId: "4821" }, "4821");
    expect(result.http).toBe(200);
    expect(result.body.data).toMatchObject({ id: "4821", status: "pending" });
    expect(fixtureApi.requests.at(-1)).toMatchObject({ method: "GET", path: "/v1/orders/4821", authorization: `Bearer ${BEARER_TOKEN}` });
  });

  it("the blocked request: a capability scoped to one order cannot be replayed against a different one", async () => {
    const fx = await mkTask("blocked-resource", [getOrder.toolName]);
    const token = await authorize(fx, getOrder.toolName, { orderId: "4821" }, "4821");
    const before = fixtureApi.requests.length;
    const result = await run(fx, token, getOrder.toolName, { orderId: "9999" }, "9999");
    expect(result.http).toBe(403);
    expect(result.body.error).toMatchObject({ code: "SCOPE_MISMATCH" });
    expect(fixtureApi.requests.length).toBe(before); // never dispatched
  });

  it("cross-tenant connection substitution: a tenant A capability naming tenant B's connector id is refused, never touching tenant B's connection", async () => {
    const crossTool = `${connectionB.connectorId}.get_order`;
    const fx = await mkTask("cross-tenant", [crossTool]);
    const token = await authorize(fx, crossTool, { orderId: "4821" }, "4821");
    const before = fixtureApi.requests.length;
    const result = await run(fx, token, crossTool, { orderId: "4821" }, "4821");
    expect(result.http).toBe(503);
    expect(result.body.error).toMatchObject({ code: "CONNECTOR_NOT_CONFIGURED" });
    expect(fixtureApi.requests.length).toBe(before);
  });

  it("wrong-operation substitution: a capability minted for get_order cannot be redirected to cancel_order", async () => {
    const fx = await mkTask("wrong-op", [getOrder.toolName, cancelOrder.toolName]);
    const token = await authorize(fx, getOrder.toolName, { orderId: "4821" }, "4821");
    const before = fixtureApi.requests.length;
    const result = await executeConnectorOperation(
      {
        credentialSecret: fx.secret,
        tokenHash: hashCapabilityToken(token),
        tool: cancelOrder.toolName,
        operation: "cancel_order",
        resource: "4821",
        args: { orderId: "4821" },
        idempotencyKey: key("exec"),
      },
      defaultConnectorExecutorDeps,
    );
    expect(result.http).toBe(403);
    expect(result.body.error).toMatchObject({ code: "SCOPE_MISMATCH" });
    expect(fixtureApi.requests.length).toBe(before);
  });

  it("concurrent consumption: a single-use capability dispatched twice in parallel is honored exactly once", async () => {
    const fx = await mkTask("concurrent", [getOrder.toolName]);
    const token = await authorize(fx, getOrder.toolName, { orderId: "5190" }, "5190", 1);
    const [a, b] = await Promise.all([
      run(fx, token, getOrder.toolName, { orderId: "5190" }, "5190", key("race")),
      run(fx, token, getOrder.toolName, { orderId: "5190" }, "5190", key("race")),
    ]);
    const outcomes = [a.http, b.http].sort();
    expect(outcomes[0]).toBe(200);
    expect([403, 409]).toContain(outcomes[1]); // CAPABILITY_ALREADY_USED or a RESERVATION_IN_PROGRESS race loser
    const successes = [a, b].filter((r) => r.http === 200);
    expect(successes).toHaveLength(1);
  });

  it("revocation: disconnecting the connection revokes an already-issued capability before it executes", async () => {
    const revocable = await createCustomApiConnection({ tenantId: TENANT_A_ID, adminUserId: ADMIN_A_USER_ID, label: "revocable" });
    const op = await publishOperation(revocable, {
      operationSlug: "get_order",
      name: "Get order",
      method: "GET",
      pathTemplate: "/v1/orders/{orderId}",
      effect: "read",
      inputSchema: { schemaVersion: 1, fields: [{ key: "orderId", type: "string", required: true, identifiesResource: true, in: "path" }] },
    });
    const fx = await mkTask("revocation", [op.toolName]);
    const token = await authorize(fx, op.toolName, { orderId: "4821" }, "4821");

    await disconnectCustomApiConnection(revocable, ADMIN_A_USER_ID);

    const result = await run(fx, token, op.toolName, { orderId: "4821" }, "4821");
    expect(result.http).not.toBe(200);
    expect((result.body.error as { code?: string } | undefined)?.code).toMatch(/REVOKED|CONNECTOR_NOT_CONFIGURED|CONNECTION_UNAVAILABLE/);
    await revocable.cleanup();
  });

  it("indeterminate writes: a write whose response never arrives settles as indeterminate, not failed or succeeded", async () => {
    const fx = await mkTask("indeterminate", [cancelOrder.toolName]);
    const token = await authorize(fx, cancelOrder.toolName, { orderId: "4821" }, "4821");

    const hangingFetch: typeof fixtureApi.fetch = () => new Promise(() => {}); // never resolves
    resetConnectorRegistryForTests();
    registerConnector(createCustomApiConnector({ ...defaultCustomApiConnectorDeps, fetch: hangingFetch }));
    try {
      const result = await executeConnectorOperation(
        {
          credentialSecret: fx.secret,
          tokenHash: hashCapabilityToken(token),
          tool: cancelOrder.toolName,
          operation: "cancel_order",
          resource: "4821",
          args: { orderId: "4821" },
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
      registerConnector(createCustomApiConnector({ ...defaultCustomApiConnectorDeps, fetch: fixtureApi.fetch }));
    }
  });
});
