import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createCustomApiConnector,
  defaultCustomApiConnectorDeps,
} from "@/lib/connectors/custom-api/connector";
import { defaultConnectorExecutorDeps, executeConnectorOperation } from "@/lib/connectors/executor";
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
import { WidgetOrdersFixtureApi } from "./custom-api-fixture-provider";
import {
  closeGatewayPool,
  createCustomApiConnection,
  publishOperation,
  setBearerSecret,
  type CustomApiConnectionFixture,
  type PublishedOperationFixture,
} from "./custom-api-support";

/**
 * The Custom API connector through the FULL backend-credential task
 * lifecycle added this session -- prepareTask() -> session -> tool
 * manifest -> authorize -> execute -- as opposed to
 * custom-api-connector.test.ts, which drives the lower-level pipeline
 * against a contract inserted directly as already-`active`.
 *
 * Like Postgres (see postgres-connector-lifecycle.test.ts's own comment),
 * Custom API operations are per-tenant PUBLISHED operations:
 * `buildTenantRegistry` synthesizes one dedicated, non-bundled permission
 * per published operation (`operations: [item.toolName]`, `resourceBreadth:
 * 1`) -- genuinely 1:1, so the solver selects it here with zero excess
 * operations too. This contract still can never auto-activate, for the
 * identical registry-generation reason: `toolOperationFor` in
 * registry/tenant.ts unconditionally marks every tenant-published operation
 * `dataSensitivity: "confidential"` (Rule 3) and `externalCommunication:
 * true` (Rule 5, via plan-validator's mandatory requires_review finding),
 * regardless of read/write effect. Either flag alone forces
 * `required_approvals_spec` non-empty, so `automation_policies` allow-
 * listing has no effect on this outcome -- confirmed here, not assumed.
 */

describe("Custom API connector -- full backend lifecycle (prepareTask -> session -> tools -> authorize -> execute)", () => {
  let connection: CustomApiConnectionFixture;
  let getOrder: PublishedOperationFixture;
  let fixtureApi: WidgetOrdersFixtureApi;
  const BEARER_TOKEN = "fixture-bearer-lifecycle-9f2a";

  beforeAll(async () => {
    fixtureApi = new WidgetOrdersFixtureApi();
    fixtureApi.requiredBearerToken = BEARER_TOKEN;

    resetConnectorRegistryForTests();
    registerConnector(
      createCustomApiConnector({ ...defaultCustomApiConnectorDeps, fetch: fixtureApi.fetch }),
    );

    connection = await createCustomApiConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "widget-orders-lifecycle",
    });
    getOrder = await publishOperation(connection, {
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
    await setBearerSecret(connection, BEARER_TOKEN);
  }, 60_000);

  afterAll(async () => {
    await connection?.cleanup();
    resetConnectorRegistryForTests();
    await closeGatewayPool();
  }, 30_000);

  it("prepares, sessions, lists, authorizes and executes get_order end to end", async () => {
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix, "capi-lc");
    const agent = await createAgentWithRuntimeKey(`capi-lc-${suffix}`);
    const TOOL = getOrder.toolName;
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
        intent: "Get order 4821",
        connectorBindings: [{ connectorId: connection.connectorId, connectionId: connection.connectionId }],
      });
      expect(created.status).toBe("ok");
      taskId = created.taskId!;

      await allowAutomation(app.applicationId, TOOL);

      const plan = planFor(taskId, TOOL, { orderId: "4821" }, { resourceBinding: "4821" });
      const prepared = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;

      // See this file's top-of-module comment: dataSensitivity "confidential"
      // (Rule 3) and externalCommunication true (Rule 5) both fire
      // unconditionally for every tenant-published operation -- NOT excess
      // operations (the permission is already dedicated/1:1). Allow-listing
      // above has no effect on this outcome.
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
        operation: "get_order",
        resource: "4821",
        arguments: { orderId: "4821" },
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
          operation: "get_order",
          resource: "4821",
          args: { orderId: "4821" },
          idempotencyKey: `exec-${suffix}`,
        },
        defaultConnectorExecutorDeps,
      );
      expect(execResult.http).toBe(200);
      expect(execResult.body.data).toMatchObject({ id: "4821", status: "pending" });
      expect(fixtureApi.requests.at(-1)).toMatchObject({
        method: "GET",
        path: "/v1/orders/4821",
        authorization: `Bearer ${BEARER_TOKEN}`,
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
    // Custom API connection (fixed destination, SSRF-guarded) -- never a
    // mailbox-style per-customer ownership model -- so the multi-customer
    // pattern is delegating that one connection to the customers allowed to
    // use it.
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix, "capi-ab");
    const agent = await createAgentWithRuntimeKey(`capi-ab-${suffix}`);
    const TOOL = getOrder.toolName;
    const taskIds: string[] = [];

    try {
      const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });
      const bob = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "bob" });
      await delegateConnection(connection.connectionId, alex.customerId!);
      await allowAutomation(app.applicationId, TOOL);

      // Bob: same app, same (org-owned) connection, never delegated to him.
      const bobTask = await createCustomerTask({
        credentialSecret: app.backendSecret,
        customerId: bob.customerId!,
        agentId: agent.agentId,
        intent: "Get order 4821",
        connectorBindings: [{ connectorId: connection.connectorId, connectionId: connection.connectionId }],
      });
      expect(bobTask.status).toBe("connection_not_usable_by_customer");
      expect(bobTask.taskId).toBeNull();

      // Alex: genuinely delegated -- goes all the way to a real (fixture) execution with a persisted receipt.
      const alexTask = await createCustomerTask({
        credentialSecret: app.backendSecret,
        customerId: alex.customerId!,
        agentId: agent.agentId,
        intent: "Get order 4821",
        connectorBindings: [{ connectorId: connection.connectorId, connectionId: connection.connectionId }],
      });
      expect(alexTask.status).toBe("ok");
      taskIds.push(alexTask.taskId!);

      const plan = planFor(alexTask.taskId!, TOOL, { orderId: "4821" }, { resourceBinding: "4821" });
      const prepared = await prepareTask({
        credentialSecret: app.backendSecret,
        taskId: alexTask.taskId!,
        plan,
      });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.outcome.status).toBe("awaiting_approval");
      if (prepared.outcome.status !== "awaiting_approval") return;
      await activateContractDirectly(prepared.outcome.contractId, TENANT_A_ID, app.applicationId);

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
        operation: "get_order",
        resource: "4821",
        arguments: { orderId: "4821" },
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
          operation: "get_order",
          resource: "4821",
          args: { orderId: "4821" },
          idempotencyKey: `ab-exec-${suffix}`,
        },
        defaultConnectorExecutorDeps,
      );
      expect(execResult.http).toBe(200);

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
        intent: "Get order 4821 (after revocation)",
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
