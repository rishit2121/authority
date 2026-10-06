import { createHash, randomBytes } from "node:crypto";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";
import {
  bindTaskGithubRepositoryForBackend,
  listCustomerGithubRepositoriesForBackend,
} from "@/lib/gateway/rpc-github-delegation";
import { createCustomerTask, createOrResolveCustomer } from "@/lib/gateway/rpc-customers";
import { prepareTask } from "@/lib/gateway/prepare-task";
import { getContractForBackend } from "@/lib/gateway/rpc-tasks-lifecycle";
import { defaultExecutorDeps, executeGithubOperation } from "@/lib/github/executor";

import {
  createGatewayFixture,
  currentTenantVersions,
  ensureMockInstallation,
  type GatewayFixture,
} from "../gateway-support";
import { managementQuery, TENANT_A_ID } from "../support";
import {
  ADMIN_A_USER_ID,
  createCustomApiConnection,
  publishOperation,
} from "../connectors/custom-api-support";
import { createPostgresConnection, publishQuery } from "../connectors/postgres-support";

/**
 * Proves GitHub's new customer-delegation layer added in
 * 20261003000015_github_customer_delegation.sql: a repository is usable
 * through the backend-credential API only once explicitly delegated to the
 * task's own customer -- never implicitly from the tenant's allowlist alone
 * -- while the pre-existing dashboard path
 * (public.github_bind_task_repository, exercised elsewhere) keeps working
 * unchanged, since both now share the same core.
 */

const BACKEND_SECRET_PREFIX = "authority_dk_";

function mintBackendSecret(): { plaintext: string; hash: string } {
  const plaintext = `${BACKEND_SECRET_PREFIX}${randomBytes(32).toString("hex")}`;
  return { plaintext, hash: createHash("sha256").update(plaintext).digest("hex") };
}

interface AppFixture {
  applicationId: string;
  backendSecret: string;
  cleanup: () => Promise<void>;
}

async function createApplicationFixture(suffix: string): Promise<AppFixture> {
  const applicationId = `cccc0000-0000-4000-8000-${suffix}0000`;
  const { plaintext, hash } = mintBackendSecret();
  const keyPrefix = plaintext.slice(0, 21);

  await managementQuery(`
    insert into public.applications (id, tenant_id, name, slug)
    values ('${applicationId}', '${TENANT_A_ID}', 'GitHub delegation test app', 'ghd-${suffix}');

    insert into public.developer_backend_credentials (tenant_id, application_id, key_prefix, key_hash)
    values ('${TENANT_A_ID}', '${applicationId}', '${keyPrefix}', '${hash}');
  `);

  return {
    applicationId,
    backendSecret: plaintext,
    cleanup: async () => {
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.automation_policies where application_id = '${applicationId}';
        delete from public.developer_backend_credentials where application_id = '${applicationId}';
        delete from public.customers where application_id = '${applicationId}';
        delete from public.applications where id = '${applicationId}';
      `);
    },
  };
}

async function repositoryIdFor(fullName: string): Promise<string> {
  const [owner, name] = fullName.split("/");
  const rows = (await managementQuery(
    `select id from public.github_repositories where tenant_id = '${TENANT_A_ID}' and owner = '${owner}' and name = '${name}';`,
  )) as Array<{ id: string }>;
  if (!rows[0]) throw new Error(`fixture repository ${fullName} not found`);
  return rows[0].id;
}

async function delegateRepository(repositoryId: string, customerId: string): Promise<void> {
  await managementQuery(`
    insert into public.github_repository_customer_delegations (tenant_id, repository_id, customer_id)
    values ('${TENANT_A_ID}', '${repositoryId}', '${customerId}');
  `);
}

async function allowAutomation(applicationId: string, tool: string): Promise<void> {
  await managementQuery(`
    insert into public.automation_policies (tenant_id, application_id, tool)
    values ('${TENANT_A_ID}', '${applicationId}', '${tool}');
  `);
}

describe("GitHub repository customer delegation (real database)", () => {
  const apps: AppFixture[] = [];
  const taskIds: string[] = [];
  const fixtures: GatewayFixture[] = [];

  // Required for executeGithubOperation to route to the in-memory mock
  // instead of attempting a real GitHub call -- same flag
  // github-connector.test.ts's own beforeAll sets.
  beforeAll(() => {
    process.env.GITHUB_EXECUTION_MODE = "mock";
  });

  afterEach(async () => {
    for (const taskId of taskIds.splice(0, taskIds.length)) {
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.jev_risk_evaluations where task_id = '${taskId}';
        delete from public.jev_necessity_evaluations where task_id = '${taskId}';
        delete from public.jev_plan_completeness_evaluations where task_id = '${taskId}';
        delete from public.github_execution_receipts where task_id = '${taskId}';
        delete from public.capability_reservations where task_id = '${taskId}';
        delete from public.runtime_approval_decisions where request_id in (select id from public.runtime_approval_requests where task_id = '${taskId}');
        delete from public.capability_consumptions where capability_id in (select id from public.capability_tokens where task_id = '${taskId}');
        delete from public.capability_tokens where task_id = '${taskId}';
        delete from public.runtime_approval_requests where task_id = '${taskId}';
        delete from public.final_decisions where task_id = '${taskId}';
        delete from public.semantic_evaluations where task_id = '${taskId}';
        delete from public.semantic_shadow_evaluations where task_id = '${taskId}';
        delete from public.execution_events where task_id = '${taskId}';
        delete from public.authorization_decisions where task_id = '${taskId}';
        delete from public.capabilities where task_id = '${taskId}';
        delete from public.tool_requests where task_id = '${taskId}';
        delete from public.task_repository_bindings where task_id = '${taskId}';
        delete from public.contract_compilations where task_id = '${taskId}';
        delete from public.task_authority_contracts where task_id = '${taskId}';
        delete from public.plan_nodes where plan_id in (select id from public.plans where task_id = '${taskId}');
        delete from public.plans where task_id = '${taskId}';
        delete from public.tasks where id = '${taskId}';
      `);
    }
    // Must precede `apps` cleanup: delegations reference customers, which
    // that cleanup deletes.
    await managementQuery(`
      set local role postgres;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.github_repository_customer_delegations where tenant_id = '${TENANT_A_ID}';
    `);
    while (apps.length > 0) {
      await apps.pop()?.cleanup();
    }
    while (fixtures.length > 0) {
      await fixtures.pop()?.cleanup();
    }
  });

  const mkAgent = async (label: string) => {
    const fx = await createGatewayFixture({ label });
    fixtures.push(fx);
    return fx;
  };

  it("lists only repositories explicitly delegated to this customer, and binds one to a task", async () => {
    await ensureMockInstallation();
    const repoId = await repositoryIdFor("acme/widgets");

    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);

    const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });
    const bob = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "bob" });

    const beforeDelegation = await listCustomerGithubRepositoriesForBackend(
      app.backendSecret,
      alex.customerId!,
    );
    expect(beforeDelegation.status).toBe("ok");
    expect(beforeDelegation.repositories).toEqual([]);

    await delegateRepository(repoId, alex.customerId!);

    const afterDelegation = await listCustomerGithubRepositoriesForBackend(
      app.backendSecret,
      alex.customerId!,
    );
    expect(afterDelegation.repositories.map((r) => r.repositoryId)).toEqual([repoId]);
    expect(afterDelegation.repositories[0].owner).toBe("acme");
    expect(afterDelegation.repositories[0].name).toBe("widgets");

    // Bob never had it delegated -- still sees nothing.
    const bobList = await listCustomerGithubRepositoriesForBackend(app.backendSecret, bob.customerId!);
    expect(bobList.repositories).toEqual([]);

    const agent = await mkAgent("github-delegation-alex");
    const task = await createCustomerTask({
      credentialSecret: app.backendSecret,
      customerId: alex.customerId!,
      agentId: agent.agentId,
      intent: "Read an issue in acme/widgets",
      connectorBindings: [],
    });
    expect(task.status).toBe("ok");
    taskIds.push(task.taskId!);

    const bindResult = await bindTaskGithubRepositoryForBackend({
      credentialSecret: app.backendSecret,
      taskId: task.taskId!,
      repositoryId: repoId,
    });
    expect(bindResult).toBe("ok");

    const bound = (await managementQuery(
      `select repository_id from public.task_repository_bindings where task_id = '${task.taskId}';`,
    )) as Array<{ repository_id: string }>;
    expect(bound[0]?.repository_id).toBe(repoId);

    // Binding again is refused, not silently repeated.
    const secondBind = await bindTaskGithubRepositoryForBackend({
      credentialSecret: app.backendSecret,
      taskId: task.taskId!,
      repositoryId: repoId,
    });
    expect(secondBind).toBe("already_bound");
  });

  it("refuses to bind a repository never delegated to this customer", async () => {
    await ensureMockInstallation();
    const repoId = await repositoryIdFor("acme/fault-write-timeout");

    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);

    const bob = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "bob" });
    const agent = await mkAgent("github-delegation-bob");

    const task = await createCustomerTask({
      credentialSecret: app.backendSecret,
      customerId: bob.customerId!,
      agentId: agent.agentId,
      intent: "Read an issue",
      connectorBindings: [],
    });
    taskIds.push(task.taskId!);

    const bindResult = await bindTaskGithubRepositoryForBackend({
      credentialSecret: app.backendSecret,
      taskId: task.taskId!,
      repositoryId: repoId,
    });
    expect(bindResult).toBe("repository_not_usable_by_customer");

    const bound = await managementQuery(
      `select 1 from public.task_repository_bindings where task_id = '${task.taskId}';`,
    );
    expect(bound).toEqual([]);
  });

  it("Alex (delegated) executes successfully; Bob (same app, not delegated) is denied with zero dispatch; revocation then denies Alex too", async () => {
    // The true two-customer proof point 3 of the connector-matrix review
    // flagged as missing: the pre-existing "refuses to bind a repository
    // never delegated to this customer" test used a single customer who
    // never had ANY delegation -- it never proved that one customer's own,
    // real delegation leaves a DIFFERENT customer denied for the exact same
    // repository, nor that revoking a delegation actually prevents later
    // use (rather than just a hypothetical no-delegation state).
    await ensureMockInstallation();
    const repoId = await repositoryIdFor("acme/widgets");

    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);

    const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });
    const bob = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "bob" });
    await delegateRepository(repoId, alex.customerId!);
    await allowAutomation(app.applicationId, "github.get_issue");

    const agent = await mkAgent("github-ab-delegation");

    // Bob: same app, same repository, never delegated to him -- denied
    // before any task_repository_bindings row, before any contract, before
    // any dispatch to GitHub at all.
    const bobTask = await createCustomerTask({
      credentialSecret: app.backendSecret,
      customerId: bob.customerId!,
      agentId: agent.agentId,
      intent: "Read issue 1 in acme/widgets",
      connectorBindings: [],
    });
    taskIds.push(bobTask.taskId!);
    const bobBind = await bindTaskGithubRepositoryForBackend({
      credentialSecret: app.backendSecret,
      taskId: bobTask.taskId!,
      repositoryId: repoId,
    });
    expect(bobBind).toBe("repository_not_usable_by_customer");
    const bobBound = await managementQuery(
      `select 1 from public.task_repository_bindings where task_id = '${bobTask.taskId}';`,
    );
    expect(bobBound).toEqual([]);
    const bobReceipts = await managementQuery(
      `select 1 from public.github_execution_receipts where task_id = '${bobTask.taskId}';`,
    );
    expect(bobReceipts).toEqual([]);

    // Alex: genuinely delegated, same repository -- goes all the way to a
    // real (mock) execution and a persisted receipt.
    const alexTask = await createCustomerTask({
      credentialSecret: app.backendSecret,
      customerId: alex.customerId!,
      agentId: agent.agentId,
      intent: "Read issue 1 in acme/widgets",
      connectorBindings: [],
    });
    taskIds.push(alexTask.taskId!);
    const alexBind = await bindTaskGithubRepositoryForBackend({
      credentialSecret: app.backendSecret,
      taskId: alexTask.taskId!,
      repositoryId: repoId,
    });
    expect(alexBind).toBe("ok");

    const alexOutcome = await prepareTask({
      credentialSecret: app.backendSecret,
      taskId: alexTask.taskId!,
      plan: {
        schemaVersion: 1,
        taskId: alexTask.taskId!,
        nodes: [
          {
            id: "n1",
            sequence: 0,
            tool: "github.get_issue",
            arguments: { issue_number: "1" },
            resourceBinding: "acme/widgets",
            dependencies: [],
            declaredOutputs: [],
            dataFlowRefs: [],
            expectedSideEffect: "read",
            maxInvocations: 1,
          },
        ],
      },
    });
    expect(alexOutcome.ok).toBe(true);
    if (!alexOutcome.ok) return;
    expect(alexOutcome.outcome.status).toBe("ready");

    const alexDecision = await authorizeThroughGateway({
      credentialSecret: agent.secret,
      taskId: alexTask.taskId!,
      tool: "github.get_issue",
      operation: "get_issue",
      resource: "acme/widgets",
      arguments: { issue_number: "1" },
      idempotencyKey: `github-ab-auth-${suffix}`,
      ...(await currentTenantVersions(TENANT_A_ID)),
    });
    expect(alexDecision.kind).toBe("decision");
    if (alexDecision.kind !== "decision") return;
    expect(["allow", "allow_constrained"]).toContain(alexDecision.commit.finalOutcome);

    const alexExecuted = await executeGithubOperation(
      {
        credentialSecret: agent.secret,
        tokenHash: hashCapabilityToken(alexDecision.capabilityToken!),
        tool: "github.get_issue",
        operation: "get_issue",
        resource: "acme/widgets",
        args: { issue_number: "1" },
        idempotencyKey: `github-ab-exec-${suffix}`,
      },
      defaultExecutorDeps,
    );
    expect(alexExecuted.http).toBe(200);
    expect((alexExecuted.body as { result?: string }).result).toMatch(/^succeeded/);

    // Revoke Alex's delegation (direct SQL, mirroring this file's own
    // cleanup convention -- public.revoke_github_repository_delegation()
    // itself requires a real auth.uid() dashboard session). A second,
    // never-bound task for Alex against the same repository must now be
    // denied exactly like Bob's -- revocation genuinely prevents
    // subsequent use, not merely "no delegation was ever granted."
    await managementQuery(`
      set local role postgres;
      update public.github_repository_customer_delegations
      set revoked_at = now(), revoked_by = (
        select tm.user_id from public.tenant_memberships tm where tm.tenant_id = '${TENANT_A_ID}' limit 1
      )
      where repository_id = '${repoId}' and customer_id = '${alex.customerId}' and revoked_at is null;
    `);

    const alexTask2 = await createCustomerTask({
      credentialSecret: app.backendSecret,
      customerId: alex.customerId!,
      agentId: agent.agentId,
      intent: "Read issue 1 in acme/widgets (after revocation)",
      connectorBindings: [],
    });
    taskIds.push(alexTask2.taskId!);
    const alexBind2 = await bindTaskGithubRepositoryForBackend({
      credentialSecret: app.backendSecret,
      taskId: alexTask2.taskId!,
      repositoryId: repoId,
    });
    expect(alexBind2).toBe("repository_not_usable_by_customer");
  });

  it("a GitHub task goes all the way from creation through a real (mock) execution via the backend API", async () => {
    // The end-to-end proof that GitHub now participates in the same
    // developer workflow as every other connector: create a customer-scoped
    // task with no connector_connections at all, bind a delegated
    // repository as its own explicit step, prepare a contract for
    // github.get_issue through the identical deterministic pipeline, reach
    // automatic activation the same way github.get_issue already does in
    // task-lifecycle-backend.test.ts, then run a real authorize -> execute
    // call against the mock GitHub backend -- GitHub's own execution path,
    // approvals and replay protection, completely unchanged.
    await ensureMockInstallation();
    const repoId = await repositoryIdFor("acme/widgets");

    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);

    const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });
    await delegateRepository(repoId, alex.customerId!);

    const agent = await mkAgent("github-full-workflow");
    const task = await createCustomerTask({
      credentialSecret: app.backendSecret,
      customerId: alex.customerId!,
      agentId: agent.agentId,
      intent: "Read issue 1 in acme/widgets",
      connectorBindings: [],
    });
    taskIds.push(task.taskId!);

    const bindResult = await bindTaskGithubRepositoryForBackend({
      credentialSecret: app.backendSecret,
      taskId: task.taskId!,
      repositoryId: repoId,
    });
    expect(bindResult).toBe("ok");

    await allowAutomation(app.applicationId, "github.get_issue");

    const outcome = await prepareTask({
      credentialSecret: app.backendSecret,
      taskId: task.taskId!,
      plan: {
        schemaVersion: 1,
        taskId: task.taskId!,
        nodes: [
          {
            id: "n1",
            sequence: 0,
            tool: "github.get_issue",
            arguments: { issue_number: "1" },
            resourceBinding: "acme/widgets",
            dependencies: [],
            declaredOutputs: [],
            dataFlowRefs: [],
            expectedSideEffect: "read",
            maxInvocations: 1,
          },
        ],
      },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.outcome.status).toBe("ready");

    const contract = await getContractForBackend(
      app.backendSecret,
      (outcome.outcome as { contractId: string }).contractId,
    );
    expect(contract.contractStatus).toBe("active");

    const decision = await authorizeThroughGateway({
      credentialSecret: agent.secret,
      taskId: task.taskId!,
      tool: "github.get_issue",
      operation: "get_issue",
      resource: "acme/widgets",
      arguments: { issue_number: "1" },
      idempotencyKey: `github-full-workflow-auth-${suffix}`,
      ...(await currentTenantVersions(TENANT_A_ID)),
    });
    expect(decision.kind).toBe("decision");
    if (decision.kind !== "decision") return;
    expect(["allow", "allow_constrained"]).toContain(decision.commit.finalOutcome);
    expect(decision.capabilityToken).toBeTruthy();

    const executed = await executeGithubOperation(
      {
        credentialSecret: agent.secret,
        tokenHash: hashCapabilityToken(decision.capabilityToken!),
        tool: "github.get_issue",
        operation: "get_issue",
        resource: "acme/widgets",
        args: { issue_number: "1" },
        idempotencyKey: `github-full-workflow-exec-${suffix}`,
      },
      defaultExecutorDeps,
    );
    expect(executed.http).toBe(200);
    expect((executed.body as { result?: string }).result).toMatch(/^succeeded/);
  });

  it("GitHub authorization still succeeds for a tenant with published Custom API and Postgres operations", async () => {
    // Confirmed this session: prepareTask() compiles every contract
    // against buildTenantRegistry(tenantId), which appends a content-hash
    // suffix to the registry version the moment this tenant has ANYTHING
    // published in Custom API or Postgres (registry/tenant.ts). A test
    // that reads the registry version from the bare fixture file --
    // instead of the same buildTenantRegistry() call production code
    // actually uses -- diverges the moment that's true, and GitHub's own
    // authorize call fails with UNSUPPORTED_CONTRACT_VERSION despite
    // GitHub's own delegation logic being entirely uninvolved. This proves
    // the fix (currentTenantVersions()) holds with the tenant in exactly
    // that state, not just when it happens to be clean.
    await ensureMockInstallation();
    const repoId = await repositoryIdFor("acme/widgets");

    const customApi = await createCustomApiConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "alongside-github-custom-api",
    });
    const postgres = await createPostgresConnection({
      tenantId: TENANT_A_ID,
      adminUserId: ADMIN_A_USER_ID,
      label: "alongside-github-postgres",
    });
    try {
      await publishOperation(customApi, {
        operationSlug: "get_order",
        name: "Get order",
        method: "GET",
        pathTemplate: "/v1/orders/{orderId}",
        effect: "read",
        inputSchema: {
          schemaVersion: 1,
          fields: [{ key: "orderId", type: "string", required: true, identifiesResource: true, in: "path" }],
        },
      });
      await publishQuery(postgres, {
        querySlug: "get_customer_orders",
        name: "Get customer orders",
        sqlTemplate: "select id, status from orders where customer_id = :customerId",
        effect: "read",
        inputSchema: {
          schemaVersion: 1,
          fields: [{ key: "customerId", type: "string", required: true, identifiesResource: true }],
        },
      });

      const suffix = randomBytes(4).toString("hex");
      const app = await createApplicationFixture(suffix);
      apps.push(app);

      const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });
      await delegateRepository(repoId, alex.customerId!);
      await allowAutomation(app.applicationId, "github.get_issue");

      const agent = await mkAgent("github-alongside-custom-api-postgres");
      const task = await createCustomerTask({
        credentialSecret: app.backendSecret,
        customerId: alex.customerId!,
        agentId: agent.agentId,
        intent: "Read issue 1 in acme/widgets",
        connectorBindings: [],
      });
      taskIds.push(task.taskId!);

      const bindResult = await bindTaskGithubRepositoryForBackend({
        credentialSecret: app.backendSecret,
        taskId: task.taskId!,
        repositoryId: repoId,
      });
      expect(bindResult).toBe("ok");

      const outcome = await prepareTask({
        credentialSecret: app.backendSecret,
        taskId: task.taskId!,
        plan: {
          schemaVersion: 1,
          taskId: task.taskId!,
          nodes: [
            {
              id: "n1",
              sequence: 0,
              tool: "github.get_issue",
              arguments: { issue_number: "1" },
              resourceBinding: "acme/widgets",
              dependencies: [],
              declaredOutputs: [],
              dataFlowRefs: [],
              expectedSideEffect: "read",
              maxInvocations: 1,
            },
          ],
        },
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.outcome.status).toBe("ready");

      const decision = await authorizeThroughGateway({
        credentialSecret: agent.secret,
        taskId: task.taskId!,
        tool: "github.get_issue",
        operation: "get_issue",
        resource: "acme/widgets",
        arguments: { issue_number: "1" },
        idempotencyKey: `github-alongside-auth-${suffix}`,
        ...(await currentTenantVersions(TENANT_A_ID)),
      });
      expect(decision.kind).toBe("decision");
      if (decision.kind !== "decision") return;
      // Not weakened: this is still the real, production version check --
      // it passes here because both the contract and the authorize call
      // now read the SAME tenant-scoped registry version, not because the
      // check itself was loosened.
      expect(["allow", "allow_constrained"]).toContain(decision.commit.finalOutcome);
      expect(decision.capabilityToken).toBeTruthy();
    } finally {
      await postgres.cleanup();
      await customApi.cleanup();
    }
  });
});
