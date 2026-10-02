import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createPostgresConnector, defaultPostgresConnectorDeps } from "@/lib/connectors/postgres/connector";
import { defaultConnectorExecutorDeps, executeConnectorOperation } from "@/lib/connectors/executor";
import { registerConnector, resetConnectorRegistryForTests } from "@/lib/connectors/registry";
import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";

import { createGatewayFixture, currentVersions, type GatewayFixture } from "../gateway-support";
import { managementQuery } from "../support";
import { PostgresFixtureApi } from "./postgres-fixture-provider";
import {
  ADMIN_A_USER_ID,
  OWNER_B_USER_ID,
  TENANT_A_ID,
  TENANT_B_ID,
  closeGatewayPool,
  createPostgresConnection,
  disconnectPostgresConnection,
  publishQuery,
  setPostgresCredentials,
  type PostgresConnectionFixture,
  type PublishedQueryFixture,
} from "./postgres-support";

/**
 * The Postgres connector against the real database (reserve -> dispatch ->
 * settle, real two-phase gateway RPCs, real draft/validate/publish
 * lifecycle), with the one outbound database call replaced by an in-memory
 * fixture (see postgres-fixture-provider.ts) -- the same relationship
 * custom-api-connector.test.ts has to WidgetOrdersFixtureApi. Like Custom
 * API (unlike Stripe/Slack/Gmail), Postgres's connector_id is per-connection
 * dynamic, so cross-tenant connector-id substitution is a real scenario here.
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

describe("Postgres connector (in-memory fixture, real database)", () => {
  let connectionA: PostgresConnectionFixture;
  let connectionB: PostgresConnectionFixture;
  let getCustomerOrders: PublishedQueryFixture;
  let cancelOrder: PublishedQueryFixture;
  let fixtureApi: PostgresFixtureApi;
  const fixtures: GatewayFixture[] = [];
  const USERNAME = "fixture_user";
  const PASSWORD = "fixture-pw-7a1c";

  const mkTask = async (label: string, tools: string[]) => {
    const fx = await createGatewayFixture({ label, actions: actionsFor(tools), useCurrentVersions: true });
    fixtures.push(fx);
    return fx;
  };

  beforeAll(async () => {
    fixtureApi = new PostgresFixtureApi();
    fixtureApi.requiredUsername = USERNAME;
    fixtureApi.requiredPassword = PASSWORD;

    resetConnectorRegistryForTests();
    registerConnector(
      createPostgresConnector({ ...defaultPostgresConnectorDeps, runQuery: fixtureApi.runQuery }),
    );

    connectionA = await createPostgresConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "db-a",
    });
    connectionB = await createPostgresConnection({
      tenantId: TENANT_B_ID,
      adminUserId: OWNER_B_USER_ID,
      label: "db-b",
    });

    getCustomerOrders = await publishQuery(connectionA, {
      querySlug: "get_customer_orders",
      name: "Get customer orders",
      sqlTemplate: "select id, status from orders where customer_id = :customerId",
      effect: "read",
      inputSchema: {
        schemaVersion: 1,
        fields: [{ key: "customerId", type: "string", required: true, identifiesResource: true }],
      },
    });
    await setPostgresCredentials(connectionA, USERNAME, PASSWORD);

    cancelOrder = await publishQuery(connectionA, {
      querySlug: "cancel_order",
      name: "Cancel order",
      sqlTemplate: "update orders set status = :status where id = :orderId",
      effect: "write_update",
      inputSchema: {
        schemaVersion: 1,
        fields: [
          { key: "orderId", type: "string", required: true, identifiesResource: true },
          { key: "status", type: "string", required: true, identifiesResource: false },
        ],
      },
    });
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
    await connectionA?.cleanup();
    await connectionB?.cleanup();
    resetConnectorRegistryForTests();
    await closeGatewayPool();
  }, 30_000);

  it("the allowed request: a correctly scoped capability executes against the fixture database and returns its rows", async () => {
    const fx = await mkTask("allowed", [getCustomerOrders.toolName]);
    const token = await authorize(fx, getCustomerOrders.toolName, { customerId: "cust_1" }, "cust_1");
    const result = await run(fx, token, getCustomerOrders.toolName, { customerId: "cust_1" }, "cust_1");
    expect(result.http).toBe(200);
    expect(result.body.data).toMatchObject({
      rows: [
        { id: "ord_1", status: "pending" },
        { id: "ord_2", status: "pending" },
      ],
      rowCount: 2,
    });
    expect(fixtureApi.queries.at(-1)).toMatchObject({
      sql: "select id, status from orders where customer_id = $1",
      values: ["cust_1"],
      username: USERNAME,
    });
  });

  it("the blocked request: a capability scoped to one customer cannot be replayed against a different one", async () => {
    const fx = await mkTask("blocked-resource", [getCustomerOrders.toolName]);
    const token = await authorize(fx, getCustomerOrders.toolName, { customerId: "cust_1" }, "cust_1");
    const before = fixtureApi.queries.length;
    const result = await run(fx, token, getCustomerOrders.toolName, { customerId: "cust_9" }, "cust_9");
    expect(result.http).toBe(403);
    expect(result.body.error).toMatchObject({ code: "SCOPE_MISMATCH" });
    expect(fixtureApi.queries.length).toBe(before); // never dispatched
  });

  it("cross-tenant connection substitution: a tenant A capability naming tenant B's connector id is refused, never touching tenant B's database", async () => {
    const crossTool = `${connectionB.connectorId}.get_customer_orders`;
    const fx = await mkTask("cross-tenant", [crossTool]);
    const token = await authorize(fx, crossTool, { customerId: "cust_1" }, "cust_1");
    const before = fixtureApi.queries.length;
    const result = await run(fx, token, crossTool, { customerId: "cust_1" }, "cust_1");
    expect(result.http).toBe(503);
    expect(result.body.error).toMatchObject({ code: "CONNECTOR_NOT_CONFIGURED" });
    expect(fixtureApi.queries.length).toBe(before);
  });

  it("wrong-operation substitution: a capability minted for get_customer_orders cannot be redirected to cancel_order", async () => {
    const fx = await mkTask("wrong-op", [getCustomerOrders.toolName, cancelOrder.toolName]);
    const token = await authorize(fx, getCustomerOrders.toolName, { customerId: "cust_1" }, "cust_1");
    const before = fixtureApi.queries.length;
    const result = await executeConnectorOperation(
      {
        credentialSecret: fx.secret,
        tokenHash: hashCapabilityToken(token),
        tool: cancelOrder.toolName,
        operation: "cancel_order",
        resource: "ord_1",
        args: { orderId: "ord_1", status: "cancelled" },
        idempotencyKey: key("exec"),
      },
      defaultConnectorExecutorDeps,
    );
    expect(result.http).toBe(403);
    expect(result.body.error).toMatchObject({ code: "SCOPE_MISMATCH" });
    expect(fixtureApi.queries.length).toBe(before);
  });

  it("concurrent consumption: a single-use capability dispatched twice in parallel is honored exactly once", async () => {
    const fx = await mkTask("concurrent", [getCustomerOrders.toolName]);
    const token = await authorize(fx, getCustomerOrders.toolName, { customerId: "cust_1" }, "cust_1", 1);
    const [a, b] = await Promise.all([
      run(fx, token, getCustomerOrders.toolName, { customerId: "cust_1" }, "cust_1", key("race")),
      run(fx, token, getCustomerOrders.toolName, { customerId: "cust_1" }, "cust_1", key("race")),
    ]);
    const outcomes = [a.http, b.http].sort();
    expect(outcomes[0]).toBe(200);
    expect([403, 409]).toContain(outcomes[1]); // CAPABILITY_ALREADY_USED or a RESERVATION_IN_PROGRESS race loser
    const successes = [a, b].filter((r) => r.http === 200);
    expect(successes).toHaveLength(1);
  });

  it("a write query actually mutates the fixture database exactly once", async () => {
    const fx = await mkTask("write", [cancelOrder.toolName]);
    const token = await authorize(
      fx,
      cancelOrder.toolName,
      { orderId: "ord_1", status: "cancelled" },
      "ord_1",
    );
    const result = await run(
      fx,
      token,
      cancelOrder.toolName,
      { orderId: "ord_1", status: "cancelled" },
      "ord_1",
    );
    expect(result.http).toBe(200);
    expect(fixtureApi.orders.get("ord_1")?.status).toBe("cancelled");
    expect(fixtureApi.queries.at(-1)).toMatchObject({
      sql: "update orders set status = $1 where id = $2",
      values: ["cancelled", "ord_1"],
    });
  });

  it("wrong database credentials fail the write, never silently succeeding", async () => {
    const wrongCredsApi = new PostgresFixtureApi();
    wrongCredsApi.requiredUsername = USERNAME;
    wrongCredsApi.requiredPassword = "not-the-real-password";
    resetConnectorRegistryForTests();
    registerConnector(
      createPostgresConnector({ ...defaultPostgresConnectorDeps, runQuery: wrongCredsApi.runQuery }),
    );
    try {
      const fx = await mkTask("bad-credentials", [getCustomerOrders.toolName]);
      const token = await authorize(fx, getCustomerOrders.toolName, { customerId: "cust_1" }, "cust_1");
      const result = await run(fx, token, getCustomerOrders.toolName, { customerId: "cust_1" }, "cust_1");
      expect(result.http).not.toBe(200);
    } finally {
      resetConnectorRegistryForTests();
      registerConnector(
        createPostgresConnector({ ...defaultPostgresConnectorDeps, runQuery: fixtureApi.runQuery }),
      );
    }
  });

  it("revocation: disconnecting the connection revokes an already-issued capability before it executes", async () => {
    const revocable = await createPostgresConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "revocable",
    });
    const query = await publishQuery(revocable, {
      querySlug: "get_customer_orders",
      name: "Get customer orders",
      sqlTemplate: "select id, status from orders where customer_id = :customerId",
      effect: "read",
      inputSchema: {
        schemaVersion: 1,
        fields: [{ key: "customerId", type: "string", required: true, identifiesResource: true }],
      },
    });
    const fx = await mkTask("revocation", [query.toolName]);
    const token = await authorize(fx, query.toolName, { customerId: "cust_1" }, "cust_1");

    await disconnectPostgresConnection(revocable, ADMIN_A_USER_ID);

    const result = await run(fx, token, query.toolName, { customerId: "cust_1" }, "cust_1");
    expect(result.http).not.toBe(200);
    expect((result.body.error as { code?: string } | undefined)?.code).toMatch(
      /REVOKED|CONNECTOR_NOT_CONFIGURED|CONNECTION_UNAVAILABLE/,
    );
    await revocable.cleanup();
  });

  it("indeterminate writes: a write whose response never arrives settles as indeterminate, not failed or succeeded", async () => {
    const fx = await mkTask("indeterminate", [cancelOrder.toolName]);
    const token = await authorize(
      fx,
      cancelOrder.toolName,
      { orderId: "ord_2", status: "cancelled" },
      "ord_2",
    );

    const hangingRunQuery: typeof fixtureApi.runQuery = () => new Promise(() => {}); // never resolves
    resetConnectorRegistryForTests();
    registerConnector(
      createPostgresConnector({ ...defaultPostgresConnectorDeps, runQuery: hangingRunQuery }),
    );
    try {
      const result = await executeConnectorOperation(
        {
          credentialSecret: fx.secret,
          tokenHash: hashCapabilityToken(token),
          tool: cancelOrder.toolName,
          operation: "cancel_order",
          resource: "ord_2",
          args: { orderId: "ord_2", status: "cancelled" },
          idempotencyKey: key("exec"),
        },
        // Unlike Stripe/Slack/Gmail/Custom API's single pre-write secret
        // resolve, this connector's execute() makes two real database round
        // trips (loadPublished, then credentialsFor) before it ever reaches
        // beforeWrite() -- a 150ms deadline (the value those connectors'
        // own indeterminate-write tests use) can elapse before beforeWrite()
        // is even called, which would wrongly settle as "failed" instead of
        // the "indeterminate" this test means to prove.
        { ...defaultConnectorExecutorDeps, deadlineMs: 3000 },
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
      registerConnector(
        createPostgresConnector({ ...defaultPostgresConnectorDeps, runQuery: fixtureApi.runQuery }),
      );
    }
  });
});
