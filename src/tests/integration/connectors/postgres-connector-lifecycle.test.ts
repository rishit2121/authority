import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defaultConnectorExecutorDeps, executeConnectorOperation } from "@/lib/connectors/executor";
import { createPostgresConnector, defaultPostgresConnectorDeps } from "@/lib/connectors/postgres/connector";
import { registerConnector, resetConnectorRegistryForTests } from "@/lib/connectors/registry";
import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";
import { prepareTask } from "@/lib/gateway/prepare-task";
import { createCustomerTask, createOrResolveCustomer } from "@/lib/gateway/rpc-customers";
import { createTaskSession, resolveCredential, taskSessionInfo } from "@/lib/gateway/rpc-sessions";
import { getContractForBackend } from "@/lib/gateway/rpc-tasks-lifecycle";
import { generateTaskSessionToken } from "@/lib/gateway/task-session-token";
import { buildMcpToolCatalog } from "@/lib/mcp/bridge";

import { managementQuery } from "../support";
import {
  ADMIN_A_USER_ID,
  TENANT_A_ID,
  createAgentWithRuntimeKey,
  createApplicationFixture,
  cleanupTask,
  delegateConnection,
  planFor,
} from "./backend-lifecycle-support";
import { PostgresFixtureApi } from "./postgres-fixture-provider";
import {
  closeGatewayPool,
  createPostgresConnection,
  publishQuery,
  setPostgresCredentials,
  type PostgresConnectionFixture,
  type PublishedQueryFixture,
} from "./postgres-support";

/**
 * The Postgres connector through the FULL backend-credential task lifecycle
 * added this session -- prepareTask() -> session -> tool manifest ->
 * authorize -> execute -- as opposed to postgres-connector.test.ts, which
 * drives the lower-level pipeline against a contract inserted directly as
 * already-`active`.
 *
 * Postgres queries are per-tenant PUBLISHED operations, not static registry
 * entries: `buildTenantRegistry` (src/lib/registry/tenant.ts) synthesizes
 * one permission per published query. No approval rule matches, so each
 * contract here activates as soon as it is compiled.
 */

describe("Postgres connector -- full backend lifecycle (prepareTask -> session -> tools -> authorize -> execute)", () => {
  let connection: PostgresConnectionFixture;
  let getCustomerOrders: PublishedQueryFixture;
  let fixtureApi: PostgresFixtureApi;
  const USERNAME = "fixture_user_lifecycle";
  const PASSWORD = "fixture-pw-lifecycle-9f2a";

  beforeAll(async () => {
    fixtureApi = new PostgresFixtureApi();
    fixtureApi.requiredUsername = USERNAME;
    fixtureApi.requiredPassword = PASSWORD;

    resetConnectorRegistryForTests();
    registerConnector(
      createPostgresConnector({ ...defaultPostgresConnectorDeps, runQuery: fixtureApi.runQuery }),
    );

    connection = await createPostgresConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "postgres-lifecycle",
    });
    getCustomerOrders = await publishQuery(connection, {
      querySlug: "get_customer_orders",
      name: "Get customer orders",
      sqlTemplate: "select id, status from orders where customer_id = :customerId",
      effect: "read",
      inputSchema: {
        schemaVersion: 1,
        fields: [{ key: "customerId", type: "string", required: true, identifiesResource: true }],
      },
    });
    await setPostgresCredentials(connection, USERNAME, PASSWORD);
  }, 60_000);

  afterAll(async () => {
    await connection?.cleanup();
    resetConnectorRegistryForTests();
    await closeGatewayPool();
  }, 30_000);

  it("prepares, sessions, lists, authorizes and executes get_customer_orders end to end", async () => {
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix, "pg-lc");
    const agent = await createAgentWithRuntimeKey(`pg-lc-${suffix}`);
    const TOOL = getCustomerOrders.toolName;
    let taskId: string | null = null;
    let customerId: string | null = null;

    try {
      const customer = await createOrResolveCustomer({
        credentialSecret: app.backendSecret,
        externalId: `cust-${suffix}`,
      });
      expect(customer.status).toBe("ok");
      customerId = customer.customerId!;

      await delegateConnection(connection.connectionId, customer.customerId!);

      const created = await createCustomerTask({
        credentialSecret: app.backendSecret,
        customerId: customer.customerId!,
        agentId: agent.agentId,
        intent: "Get customer orders for cust_1",
        connectorBindings: [{ connectorId: connection.connectorId, connectionId: connection.connectionId }],
      });
      expect(created.status).toBe("ok");
      taskId = created.taskId!;

      const plan = planFor(taskId, TOOL, { customerId: "cust_1" }, { resourceBinding: "cust_1" });
      const prepared = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;

      // No approval rule matches, so the contract activates as soon as it is compiled.
      expect(prepared.outcome.status).toBe("ready");
      if (prepared.outcome.status !== "ready") return;
      const contractId = prepared.outcome.contractId;

      const activeContract = await getContractForBackend(app.backendSecret, contractId);
      expect(activeContract.requiredApprovalsCount).toBe(0);
      expect(activeContract.tools).toEqual([TOOL]);
      expect(activeContract.contractStatus).toBe("active");

      // Session minted from the agent's OWN runtime key -- never the backend secret used for prepareTask().
      const { plaintext: sessionToken, hash: tokenHash } = generateTaskSessionToken();
      const session = await createTaskSession({
        credentialSecret: agent.agentSecret,
        taskId,
        tokenHash,
        ttlSeconds: 300,
      });
      expect(session.status).toBe("ok");
      expect(session.contractId).toBe(contractId);

      // Same identity + scope checks GET /api/v1/tasks/{taskId}/tools performs before building the catalog.
      const resolved = await resolveCredential(sessionToken);
      expect(resolved.status).toBe("ok");
      expect(resolved.tenantId).toBe(TENANT_A_ID);
      const sessionInfo = await taskSessionInfo(sessionToken);
      expect(sessionInfo.status).toBe("ok");
      expect(sessionInfo.taskId).toBe(taskId);

      const catalog = await buildMcpToolCatalog(taskId);
      expect(catalog.status).toBe("ok");
      expect(catalog.tools.map((t) => t.operation.id)).toEqual([TOOL]);

      const authResult = await authorizeThroughGateway({
        credentialSecret: sessionToken,
        taskId,
        tool: TOOL,
        operation: "get_customer_orders",
        resource: "cust_1",
        arguments: { customerId: "cust_1" },
        idempotencyKey: `auth-${suffix}`,
        maxUses: 1,
        registryVersion: activeContract.registryVersion!,
        compilerVersion: activeContract.compilerVersion!,
      });
      expect(authResult.kind).toBe("decision");
      if (authResult.kind !== "decision" || !authResult.capabilityToken) return;

      const execResult = await executeConnectorOperation(
        {
          credentialSecret: sessionToken,
          tokenHash: hashCapabilityToken(authResult.capabilityToken),
          tool: TOOL,
          operation: "get_customer_orders",
          resource: "cust_1",
          args: { customerId: "cust_1" },
          idempotencyKey: `exec-${suffix}`,
        },
        defaultConnectorExecutorDeps,
      );
      expect(execResult.http).toBe(200);
      expect(execResult.body.data).toMatchObject({
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

      const [receipt] = (await managementQuery(
        `select result_category, task_id from public.connector_execution_receipts where execution_id = '${execResult.body.executionId}';`,
      )) as Array<{ result_category: string; task_id: string }>;
      expect(receipt?.result_category).toBe("succeeded");
      expect(receipt?.task_id).toBe(taskId);
    } finally {
      if (taskId) await cleanupTask(taskId);
      if (customerId) {
        await managementQuery(`
          set local role postgres;
          select set_config('authority.allow_demo_purge', 'on', true);
          delete from public.connection_delegations where connection_id = '${connection.connectionId}' and customer_id = '${customerId}';
        `);
      }
      await agent.cleanup();
      await app.cleanup();
    }
  });

  it("Alex (delegated) executes successfully; Bob (same app, not delegated) is denied with zero dispatch; revocation then denies Alex too", async () => {
    // Connector-named cross-customer proof. This organization owns ONE
    // database connection -- never a mailbox-style per-customer ownership
    // model -- so the multi-customer pattern is delegating that one
    // connection to the customers allowed to use it.
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix, "pg-ab");
    const agent = await createAgentWithRuntimeKey(`pg-ab-${suffix}`);
    const TOOL = getCustomerOrders.toolName;
    const taskIds: string[] = [];

    try {
      const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });
      const bob = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "bob" });
      await delegateConnection(connection.connectionId, alex.customerId!);

      // Bob: same app, same (org-owned) connection, never delegated to him.
      const bobTask = await createCustomerTask({
        credentialSecret: app.backendSecret,
        customerId: bob.customerId!,
        agentId: agent.agentId,
        intent: "Get customer orders for cust_1",
        connectorBindings: [{ connectorId: connection.connectorId, connectionId: connection.connectionId }],
      });
      expect(bobTask.status).toBe("connection_not_usable_by_customer");
      expect(bobTask.taskId).toBeNull();

      // Alex: genuinely delegated -- goes all the way to a real (fixture) execution with a persisted receipt.
      const alexTask = await createCustomerTask({
        credentialSecret: app.backendSecret,
        customerId: alex.customerId!,
        agentId: agent.agentId,
        intent: "Get customer orders for cust_1",
        connectorBindings: [{ connectorId: connection.connectorId, connectionId: connection.connectionId }],
      });
      expect(alexTask.status).toBe("ok");
      taskIds.push(alexTask.taskId!);

      const plan = planFor(alexTask.taskId!, TOOL, { customerId: "cust_1" }, { resourceBinding: "cust_1" });
      const prepared = await prepareTask({
        credentialSecret: app.backendSecret,
        taskId: alexTask.taskId!,
        plan,
      });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.outcome.status).toBe("ready");
      if (prepared.outcome.status !== "ready") return;

      const { plaintext: sessionToken, hash: tokenHash } = generateTaskSessionToken();
      const session = await createTaskSession({
        credentialSecret: agent.agentSecret,
        taskId: alexTask.taskId!,
        tokenHash,
        ttlSeconds: 300,
      });
      expect(session.status).toBe("ok");

      const activeContract = await getContractForBackend(app.backendSecret, prepared.outcome.contractId);
      const authResult = await authorizeThroughGateway({
        credentialSecret: sessionToken,
        taskId: alexTask.taskId!,
        tool: TOOL,
        operation: "get_customer_orders",
        resource: "cust_1",
        arguments: { customerId: "cust_1" },
        idempotencyKey: `ab-auth-${suffix}`,
        maxUses: 1,
        registryVersion: activeContract.registryVersion!,
        compilerVersion: activeContract.compilerVersion!,
      });
      expect(authResult.kind).toBe("decision");
      if (authResult.kind !== "decision" || !authResult.capabilityToken) return;

      const execResult = await executeConnectorOperation(
        {
          credentialSecret: sessionToken,
          tokenHash: hashCapabilityToken(authResult.capabilityToken),
          tool: TOOL,
          operation: "get_customer_orders",
          resource: "cust_1",
          args: { customerId: "cust_1" },
          idempotencyKey: `ab-exec-${suffix}`,
        },
        defaultConnectorExecutorDeps,
      );
      expect(execResult.http).toBe(200);
      expect(execResult.body.data).toMatchObject({ rowCount: 2 });

      // Revoke Alex's delegation; a brand new task for Alex against the
      // same connection is denied identically to Bob's.
      await managementQuery(`
        set local role postgres;
        update public.connection_delegations
        set revoked_at = now()
        where connection_id = '${connection.connectionId}' and customer_id = '${alex.customerId}' and revoked_at is null;
      `);
      const alexTask2 = await createCustomerTask({
        credentialSecret: app.backendSecret,
        customerId: alex.customerId!,
        agentId: agent.agentId,
        intent: "Get customer orders for cust_1 (after revocation)",
        connectorBindings: [{ connectorId: connection.connectorId, connectionId: connection.connectionId }],
      });
      expect(alexTask2.status).toBe("connection_not_usable_by_customer");
    } finally {
      for (const taskId of taskIds) await cleanupTask(taskId);
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.connection_delegations where connection_id = '${connection.connectionId}';
      `);
      await agent.cleanup();
      await app.cleanup();
    }
  });
});
