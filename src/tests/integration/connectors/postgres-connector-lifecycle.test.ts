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
  activateContractDirectly,
  allowAutomation,
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
 * one permission per published query, covering ONLY that query
 * (`operations: [item.toolName]`, `resourceBreadth: 1`) -- genuinely 1:1,
 * never bundled with sibling operations the way Gmail's old
 * `gmail.read_scope` permission was. The solver therefore selects it with
 * zero excess operations even for this single-operation plan. Despite that,
 * this contract can never auto-activate: `toolOperationFor` in tenant.ts
 * unconditionally sets BOTH `dataSensitivity: "confidential"` (triggering
 * approval-rules.ts's Rule 3) AND `externalCommunication: true` (which
 * plan-validator.ts turns into a mandatory "requires_review" finding,
 * triggering Rule 5) for every tenant-published operation, read or write.
 * Either flag alone is sufficient to force `required_approvals_spec`
 * non-empty, so `gateway.activate_task_contract_for_backend` correctly
 * refuses automatic activation no matter what `automation_policies` says --
 * this is a broader, registry-generation-level restriction than Gmail's
 * now-fixed excess-operations false positive, affecting every Postgres (and
 * Custom API) tool uniformly, not a parallel instance of the same bug.
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

      await allowAutomation(app.applicationId, TOOL);

      const plan = planFor(taskId, TOOL, { customerId: "cust_1" }, { resourceBinding: "cust_1" });
      const prepared = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;

      // See this file's top-of-module comment: dataSensitivity "confidential"
      // (Rule 3) and externalCommunication true (Rule 5, via plan-validator's
      // requires_review) both fire unconditionally for every tenant-published
      // operation -- NOT excess operations (the permission is already
      // dedicated/1:1). Allow-listing above has no effect on this outcome.
      expect(prepared.outcome.status).toBe("awaiting_approval");
      if (prepared.outcome.status !== "awaiting_approval") return;
      const contractId = prepared.outcome.contractId;

      const beforeActivation = await getContractForBackend(app.backendSecret, contractId);
      expect(beforeActivation.requiredApprovalsCount).toBeGreaterThan(0);
      expect(beforeActivation.tools).toEqual([TOOL]);

      await activateContractDirectly(contractId, TENANT_A_ID, app.applicationId);

      const activeContract = await getContractForBackend(app.backendSecret, contractId);
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
});
