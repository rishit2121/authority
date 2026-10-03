import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defaultConnectorExecutorDeps, executeConnectorOperation } from "@/lib/connectors/executor";
import { registerConnector, resetConnectorRegistryForTests } from "@/lib/connectors/registry";
import { createSlackConnector, defaultSlackConnectorDeps } from "@/lib/connectors/slack/connector";
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
  allowAutomation,
  createAgentWithRuntimeKey,
  createApplicationFixture,
  cleanupTask,
  delegateConnection,
  planFor,
} from "./backend-lifecycle-support";
import { SlackFixtureApi } from "./slack-fixture-provider";
import {
  closeGatewayPool,
  createSlackConnection,
  setSlackBotToken,
  type SlackConnectionFixture,
} from "./slack-support";

/**
 * The Slack connector through the FULL backend-credential task lifecycle
 * added this session -- prepareTask() -> session -> tool manifest ->
 * authorize -> execute -- as opposed to slack-connector.test.ts, which
 * drives the lower-level pipeline against a contract inserted directly as
 * already-`active`. Unlike the Stripe/Postgres/Custom API lifecycle tests,
 * slack.list_channels is a genuine zero-rule case: read side effect,
 * `internal` (not confidential) data sensitivity, no external-
 * communication flag, no financial impact, and a dedicated, non-bundled
 * permission (slack.channels_read) covering only this one operation -- so
 * it is the one tool among these four connectors that actually reaches
 * "ready" through `automation_policies` allow-listing alone, with zero
 * human approval, exactly like `github.get_issue` and `gmail.list_labels`
 * in task-lifecycle-backend.test.ts.
 */

describe("Slack connector -- full backend lifecycle (prepareTask -> session -> tools -> authorize -> execute)", () => {
  let connection: SlackConnectionFixture;
  let fixtureApi: SlackFixtureApi;
  const BOT_TOKEN = "xoxb-fixture-lifecycle-9f2a";
  const TOOL = "slack.list_channels";

  beforeAll(async () => {
    fixtureApi = new SlackFixtureApi();
    fixtureApi.requiredBotToken = BOT_TOKEN;

    resetConnectorRegistryForTests();
    registerConnector(createSlackConnector({ ...defaultSlackConnectorDeps, fetch: fixtureApi.fetch }));

    connection = await createSlackConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "slack-lifecycle",
    });
    await setSlackBotToken(connection, BOT_TOKEN);
  }, 60_000);

  afterAll(async () => {
    await connection?.cleanup();
    resetConnectorRegistryForTests();
    await closeGatewayPool();
  }, 30_000);

  it("prepares, sessions, lists, authorizes and executes slack.list_channels end to end, auto-activating with zero approvals", async () => {
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix, "slack-lc");
    const agent = await createAgentWithRuntimeKey(`slack-lc-${suffix}`);
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
        intent: "List Slack channels",
        connectorBindings: [{ connectorId: "slack", connectionId: connection.connectionId }],
      });
      expect(created.status).toBe("ok");
      taskId = created.taskId!;

      // Allow-listed BEFORE prepareTask(): slack.list_channels is read,
      // `internal` sensitivity, no external communication, no financial
      // impact, and slack.channels_read is already a dedicated permission
      // (zero excess operations) -- so with the allowlist already in place,
      // the compiler's own freshly-recomputed `required_approvals_spec` is
      // empty and activation succeeds on this very first prepareTask() call.
      await allowAutomation(app.applicationId, TOOL);

      const plan = planFor(taskId, TOOL, {});
      const prepared = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.outcome.status).toBe("ready");
      if (prepared.outcome.status !== "ready") return;
      expect(prepared.outcome.tools).toEqual([TOOL]);
      const contractId = prepared.outcome.contractId;

      const activeContract = await getContractForBackend(app.backendSecret, contractId);
      expect(activeContract.contractStatus).toBe("active");
      expect(activeContract.requiredApprovalsCount).toBe(0);

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
        operation: "list_channels",
        resource: "workspace",
        arguments: {},
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
          operation: "list_channels",
          resource: "workspace",
          args: {},
          idempotencyKey: `exec-${suffix}`,
        },
        defaultConnectorExecutorDeps,
      );
      expect(execResult.http).toBe(200);
      expect(execResult.body.data).toMatchObject({ ok: true });
      expect((execResult.body.data as { channels?: unknown[] }).channels).toHaveLength(2);

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
