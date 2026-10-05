import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defaultConnectorExecutorDeps, executeConnectorOperation } from "@/lib/connectors/executor";
import { registerConnector, resetConnectorRegistryForTests } from "@/lib/connectors/registry";
import { createStripeConnector, defaultStripeConnectorDeps } from "@/lib/connectors/stripe/connector";
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
import { StripeFixtureApi } from "./stripe-fixture-provider";
import {
  closeGatewayPool,
  createStripeConnection,
  setStripeApiKey,
  type StripeConnectionFixture,
} from "./stripe-support";

/**
 * The Stripe connector through the FULL backend-credential task lifecycle
 * added this session -- prepareTask() -> session -> tool manifest ->
 * authorize -> execute -- as opposed to stripe-connector.test.ts, which
 * drives the lower-level pipeline (authorizeThroughGateway +
 * executeConnectorOperation) against a contract inserted directly as
 * already-`active`. This file proves the orchestration layer on top of
 * that: an application backend submits a structured plan for
 * stripe.retrieve_payment and the resulting contract is exercised through
 * the identical in-memory Stripe fixture API stripe-connector.test.ts
 * already uses (dependency-injected, never a real socket).
 */

describe("Stripe connector -- full backend lifecycle (prepareTask -> session -> tools -> authorize -> execute)", () => {
  let connection: StripeConnectionFixture;
  let fixtureApi: StripeFixtureApi;
  const API_KEY = "sk_test_fixture_lifecycle_9f2a";
  const TOOL = "stripe.retrieve_payment";

  beforeAll(async () => {
    fixtureApi = new StripeFixtureApi();
    fixtureApi.requiredApiKey = API_KEY;

    resetConnectorRegistryForTests();
    registerConnector(createStripeConnector({ ...defaultStripeConnectorDeps, fetch: fixtureApi.fetch }));

    connection = await createStripeConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "stripe-lifecycle",
    });
    await setStripeApiKey(connection, API_KEY);
  }, 60_000);

  afterAll(async () => {
    await connection?.cleanup();
    resetConnectorRegistryForTests();
    await closeGatewayPool();
  }, 30_000);

  it("prepares, sessions, lists, authorizes and executes stripe.retrieve_payment end to end", async () => {
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix, "stripe-lc");
    const agent = await createAgentWithRuntimeKey(`stripe-lc-${suffix}`);
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
        intent: "Retrieve payment pi_1demo",
        connectorBindings: [{ connectorId: "stripe", connectionId: connection.connectionId }],
      });
      expect(created.status).toBe("ok");
      taskId = created.taskId!;

      await allowAutomation(app.applicationId, TOOL);

      const plan = planFor(taskId, TOOL, { payment_id: "pi_1demo" }, { resourceBinding: "pi_1demo" });
      const prepared = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;

      // Every Stripe operation in this fixture (not just writes) is marked
      // `dataSensitivity: "confidential"` (see github-demo.ts), which
      // unconditionally triggers approval-rules.ts's Rule 3 regardless of
      // which permission the solver selects. stripe.payments_read is
      // ALREADY a dedicated, non-bundled permission covering only
      // stripe.retrieve_payment (zero excess operations) -- this is not the
      // "excess operations" false positive Gmail's registry fix addressed;
      // allow-listing the tool first (above) still leaves this contract
      // "awaiting_approval", confirmed here rather than assumed. No Stripe
      // tool in this fixture can ever auto-activate through
      // automation_policies alone.
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
        operation: "retrieve_payment",
        resource: "pi_1demo",
        arguments: { payment_id: "pi_1demo" },
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
          operation: "retrieve_payment",
          resource: "pi_1demo",
          args: { payment_id: "pi_1demo" },
          idempotencyKey: `exec-${suffix}`,
        },
        defaultConnectorExecutorDeps,
      );
      expect(execResult.http).toBe(200);
      expect(execResult.body.data).toMatchObject({ id: "pi_1demo", status: "succeeded" });
      expect(fixtureApi.requests.at(-1)).toMatchObject({
        method: "GET",
        path: "/v1/payment_intents/pi_1demo",
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
    // Connector-named cross-customer proof (the matrix review flagged
    // Stripe/Slack/Postgres/Custom API as having only the generic,
    // synthetic-connector-id version of this test). This organization
    // owns ONE Stripe account -- never a mailbox-style per-customer
    // ownership model -- so the only sane multi-customer pattern is
    // delegating that one connection to the customers allowed to use it,
    // exactly as `connection_delegations` already supports.
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix, "stripe-ab");
    const agent = await createAgentWithRuntimeKey(`stripe-ab-${suffix}`);
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
        intent: "Retrieve payment pi_1demo",
        connectorBindings: [{ connectorId: "stripe", connectionId: connection.connectionId }],
      });
      expect(bobTask.status).toBe("connection_not_usable_by_customer");
      expect(bobTask.taskId).toBeNull();

      // Alex: genuinely delegated -- goes all the way to a real (fixture) execution with a persisted receipt.
      await allowAutomation(app.applicationId, TOOL);
      const alexTask = await createCustomerTask({
        credentialSecret: app.backendSecret,
        customerId: alex.customerId!,
        agentId: agent.agentId,
        intent: "Retrieve payment pi_1demo",
        connectorBindings: [{ connectorId: "stripe", connectionId: connection.connectionId }],
      });
      expect(alexTask.status).toBe("ok");
      taskIds.push(alexTask.taskId!);

      const plan = planFor(alexTask.taskId!, TOOL, { payment_id: "pi_1demo" }, { resourceBinding: "pi_1demo" });
      const prepared = await prepareTask({ credentialSecret: app.backendSecret, taskId: alexTask.taskId!, plan });
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
        operation: "retrieve_payment",
        resource: "pi_1demo",
        arguments: { payment_id: "pi_1demo" },
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
          operation: "retrieve_payment",
          resource: "pi_1demo",
          args: { payment_id: "pi_1demo" },
          idempotencyKey: `ab-exec-${suffix}`,
        },
        defaultConnectorExecutorDeps,
      );
      expect(execResult.http).toBe(200);
      expect(execResult.body.data).toMatchObject({ id: "pi_1demo", status: "succeeded" });

      // Revoke Alex's delegation; a brand new task for Alex against the
      // same connection is denied identically to Bob's -- revocation
      // genuinely prevents subsequent use, not merely "never delegated."
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
        intent: "Retrieve payment pi_1demo (after revocation)",
        connectorBindings: [{ connectorId: "stripe", connectionId: connection.connectionId }],
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
