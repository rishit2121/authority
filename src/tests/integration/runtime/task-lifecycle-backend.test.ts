import { createHash, randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prepareTask } from "@/lib/gateway/prepare-task";
import { createCustomerTask, createOrResolveCustomer } from "@/lib/gateway/rpc-customers";
import { getContractForBackend } from "@/lib/gateway/rpc-tasks-lifecycle";

import { createGatewayFixture, type GatewayFixture } from "../gateway-support";
import { managementQuery, TENANT_A_ID } from "../support";

/**
 * Proves the backend-credential task lifecycle added in
 * 20261003000014_developer_task_lifecycle_api.sql end to end, against the
 * real database: an application backend can submit a structured candidate
 * plan and get a running contract back without a dashboard click -- but
 * only ever for a tool that is BOTH independently approval-free (the
 * compiler's own, freshly recomputed decision) AND explicitly allow-listed
 * for that application via `automation_policies`. A tool that genuinely
 * requires approval is never auto-activated, even once allow-listed --
 * proving the allowlist can only narrow which zero-approval contracts
 * activate automatically, never grant approval-bypass authority by itself.
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
  const applicationId = `bbbb0000-0000-4000-8000-${suffix}0000`;
  const { plaintext, hash } = mintBackendSecret();
  const keyPrefix = plaintext.slice(0, 21);

  await managementQuery(`
    insert into public.applications (id, tenant_id, name, slug)
    values ('${applicationId}', '${TENANT_A_ID}', 'Task lifecycle test app', 'tlt-${suffix}');

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

async function allowAutomation(applicationId: string, tool: string): Promise<void> {
  await managementQuery(`
    insert into public.automation_policies (tenant_id, application_id, tool)
    values ('${TENANT_A_ID}', '${applicationId}', '${tool}');
  `);
}

async function cleanupTask(taskId: string): Promise<void> {
  await managementQuery(`
    set local role postgres;
    select set_config('authority.allow_demo_purge', 'on', true);
    delete from public.contract_compilations where task_id = '${taskId}';
    delete from public.task_authority_contracts where task_id = '${taskId}';
    delete from public.plan_nodes where plan_id in (select id from public.plans where task_id = '${taskId}');
    delete from public.plans where task_id = '${taskId}';
    delete from public.tasks where id = '${taskId}';
  `);
}

function planFor(
  taskId: string,
  tool: string,
  args: Record<string, unknown>,
  options?: { resourceBinding?: string; expectedSideEffect?: string },
) {
  return {
    schemaVersion: 1,
    taskId,
    nodes: [
      {
        id: "n1",
        sequence: 0,
        tool,
        arguments: args,
        ...(options?.resourceBinding ? { resourceBinding: options.resourceBinding } : {}),
        dependencies: [],
        declaredOutputs: [],
        dataFlowRefs: [],
        expectedSideEffect: options?.expectedSideEffect ?? "read",
        maxInvocations: 1,
      },
    ],
  };
}

describe("backend-credential task lifecycle (real database)", () => {
  const fixtures: GatewayFixture[] = [];
  const apps: AppFixture[] = [];
  const taskIds: string[] = [];

  afterEach(async () => {
    for (const taskId of taskIds.splice(0, taskIds.length)) {
      await cleanupTask(taskId);
    }
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

  it("activates automatically only once the compiler requires no approval AND the tool is allow-listed -- and is idempotent on repeat", async () => {
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);
    const agent = await mkAgent("lifecycle-ready");
    const customer = await createOrResolveCustomer({
      credentialSecret: app.backendSecret,
      externalId: "alex",
    });
    expect(customer.status).toBe("ok");

    const created = await createCustomerTask({
      credentialSecret: app.backendSecret,
      customerId: customer.customerId!,
      agentId: agent.agentId,
      intent: "Read issue 1 in payments-api",
      connectorBindings: [],
    });
    expect(created.status).toBe("ok");
    const taskId = created.taskId!;
    taskIds.push(taskId);

    const idempotencyKey = `prep-${suffix}`;
    // github.get_issue has a dedicated single-operation permission
    // (github.issues_read) in the test registry, so the solver can satisfy
    // it with zero excess operations -- genuinely eligible for automatic
    // activation once allow-listed, unlike a tool whose only available
    // permission bundles in siblings the plan never asked for.
    const plan = planFor(taskId, "github.get_issue", { issue_number: "1" }, { resourceBinding: "1" });

    // No automation policy yet: the compiler requires zero approvals for
    // this minimally-scoped read, but nothing has allow-listed it for this
    // application, so activation must wait for a human.
    const first = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan, idempotencyKey });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.outcome.status).toBe("awaiting_approval");
    const contractId = first.outcome.status === "awaiting_approval" ? first.outcome.contractId : null;
    expect(contractId).toBeTruthy();

    const beforeAllow = await getContractForBackend(app.backendSecret, contractId!);
    expect(beforeAllow.contractStatus).toBe("proposed");
    expect(beforeAllow.requiredApprovalsCount).toBe(0);

    await allowAutomation(app.applicationId, "github.get_issue");

    // Same idempotency key, same plan content: reuses the exact same plan
    // and contract row (never a second version) and this time activates it.
    const second = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan, idempotencyKey });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.outcome.status).toBe("ready");
    if (second.outcome.status !== "ready") return;
    expect(second.outcome.contractId).toBe(contractId);
    expect(second.outcome.tools).toEqual(["github.get_issue"]);

    const afterAllow = await getContractForBackend(app.backendSecret, contractId!);
    expect(afterAllow.contractStatus).toBe("active");

    // Regression: a THIRD prepare() call, after the contract is already
    // active, must still report "ready" -- not regress to
    // "awaiting_approval" merely because the contract is no longer in a
    // state activate_task_contract_core() would normally transition from
    // (found via a live end-to-end run: the backend wrapper's blanket
    // exception handler was swallowing "already active" into the same
    // status as a genuinely ineligible contract).
    const third = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan, idempotencyKey });
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.outcome.status).toBe("ready");
    if (third.outcome.status !== "ready") return;
    expect(third.outcome.contractId).toBe(contractId);
  });

  it("mints a fresh contract on re-prepare once the previously-activated one has expired, rather than re-reporting the dead one as ready", async () => {
    // Regression for a real bug found via a live model-driven-agent run
    // against the deployed service: propose_task_contract_core's own dedup
    // (task_id, plan_id, registry_version, compiler_version, input_hash)
    // had no contract_status/expires_at filter at all, so it just as happily
    // "reused" an expired contract as a live one -- prepare() kept reporting
    // "ready" with a dead contractId that the real runtime execute() path
    // (which does check expiry) immediately rejected. Fixed in
    // 20261003000018 to require the matched row be either a still-undecided
    // proposal or genuinely currently-active (authz.contract_is_currently_active)
    // before treating it as reusable.
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);
    const agent = await mkAgent("lifecycle-expiry");
    const customer = await createOrResolveCustomer({
      credentialSecret: app.backendSecret,
      externalId: "alex",
    });

    const created = await createCustomerTask({
      credentialSecret: app.backendSecret,
      customerId: customer.customerId!,
      agentId: agent.agentId,
      intent: "List my Gmail labels",
      connectorBindings: [],
    });
    const taskId = created.taskId!;
    taskIds.push(taskId);

    await allowAutomation(app.applicationId, "gmail.list_labels");

    const idempotencyKey = `prep-expiry-${suffix}`;
    const plan = planFor(taskId, "gmail.list_labels", {});
    const first = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan, idempotencyKey });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.outcome.status).toBe("ready");
    if (first.outcome.status !== "ready") return;
    const firstContractId = first.outcome.contractId;

    const beforeExpiry = await getContractForBackend(app.backendSecret, firstContractId);
    expect(beforeExpiry.contractStatus).toBe("active");

    // Simulate the real passage of time past the contract's own ephemeral
    // window -- the same condition the runtime execute() path already
    // checks via authz.contract_is_currently_active.
    await managementQuery(`
      update public.task_authority_contracts
      set expires_at = now() - interval '1 minute'
      where id = '${firstContractId}';
    `);

    const second = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan, idempotencyKey });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.outcome.status).toBe("ready");
    if (second.outcome.status !== "ready") return;

    // The real proof: a genuinely fresh contract, not the expired one handed
    // back again.
    expect(second.outcome.contractId).not.toBe(firstContractId);
    const afterExpiry = await getContractForBackend(app.backendSecret, second.outcome.contractId);
    expect(afterExpiry.contractStatus).toBe("active");
    expect(afterExpiry.tools).toEqual(["gmail.list_labels"]);
  });

  it("a gmail.list_labels-only plan solves with zero excess operations and reaches ready once allow-listed", async () => {
    // Regression for the exact scenario a live quickstart run surfaced:
    // gmail.list_labels used to be coverable only by the bundled
    // gmail.read_scope permission (list_messages + get_message +
    // list_labels), so ANY plan requesting it alone incurred "excess
    // operations" and an unconditional security_admin approval -- even
    // though the compiled contract's own allowedActions never included the
    // sibling tools either way (see contract-compiler.ts's buildAllowedActions,
    // which only ever includes the plan's own requested tools, and
    // evaluate.ts's TOOL_NOT_IN_CONTRACT check, which is what actually gates
    // every tool call at authorize() time -- the registry PERMISSION a
    // solver selects to justify minimum coverage is never itself the
    // runtime authority boundary). Adding a dedicated gmail.labels_read
    // permission (github-demo.ts) fixes the false signal without touching
    // runtime enforcement at all: list_messages/get_message were never
    // reachable through this contract, and remain exactly as unreachable
    // now as before this fix.
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);
    const agent = await mkAgent("lifecycle-gmail-labels");
    const customer = await createOrResolveCustomer({
      credentialSecret: app.backendSecret,
      externalId: "alex",
    });

    const created = await createCustomerTask({
      credentialSecret: app.backendSecret,
      customerId: customer.customerId!,
      agentId: agent.agentId,
      intent: "List my Gmail labels",
      connectorBindings: [],
    });
    const taskId = created.taskId!;
    taskIds.push(taskId);

    await allowAutomation(app.applicationId, "gmail.list_labels");

    const plan = planFor(taskId, "gmail.list_labels", {});
    const result = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.status).toBe("ready");
    if (result.outcome.status !== "ready") return;
    expect(result.outcome.tools).toEqual(["gmail.list_labels"]);

    const contract = await getContractForBackend(app.backendSecret, result.outcome.contractId);
    expect(contract.requiredApprovalsCount).toBe(0);
    expect(contract.tools).toEqual(["gmail.list_labels"]);
  });

  it("never auto-activates a tool that genuinely requires approval, even once allow-listed", async () => {
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);
    const agent = await mkAgent("lifecycle-approval");
    const customer = await createOrResolveCustomer({
      credentialSecret: app.backendSecret,
      externalId: "alex",
    });

    const created = await createCustomerTask({
      credentialSecret: app.backendSecret,
      customerId: customer.customerId!,
      agentId: agent.agentId,
      intent: "Refund a Stripe payment",
      connectorBindings: [],
    });
    expect(created.status).toBe("ok");
    const taskId = created.taskId!;
    taskIds.push(taskId);

    // An admin mistakenly (or maliciously) allow-lists a tool whose own
    // plan always needs a human: it has a financial impact (Rule 4) and a
    // non-read side effect (Rule 1), both unconditional -- allow-listing it
    // must not matter.
    await allowAutomation(app.applicationId, "stripe.issue_refund");

    const plan = planFor(
      taskId,
      "stripe.issue_refund",
      { payment_id: "pi_test123", amount_cents: 500 },
      { resourceBinding: "pi_test123", expectedSideEffect: "write_create" },
    );
    const result = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.status).toBe("awaiting_approval");

    if (result.outcome.status === "awaiting_approval") {
      const contract = await getContractForBackend(app.backendSecret, result.outcome.contractId);
      expect(contract.requiredApprovalsCount).toBeGreaterThan(0);
    }
  });

  it("rejects a structurally invalid plan as a clarification, not a server error", async () => {
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);
    const agent = await mkAgent("lifecycle-clarify");
    const customer = await createOrResolveCustomer({
      credentialSecret: app.backendSecret,
      externalId: "alex",
    });

    const created = await createCustomerTask({
      credentialSecret: app.backendSecret,
      customerId: customer.customerId!,
      agentId: agent.agentId,
      intent: "Do something",
      connectorBindings: [],
    });
    const taskId = created.taskId!;
    taskIds.push(taskId);

    const result = await prepareTask({
      credentialSecret: app.backendSecret,
      taskId,
      plan: { schemaVersion: 1, taskId, nodes: [] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.status).toBe("clarification");
  });

  it("reports ai_unavailable rather than silently using a mock when no model credentials are configured", async () => {
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);
    const agent = await mkAgent("lifecycle-ai");
    const customer = await createOrResolveCustomer({
      credentialSecret: app.backendSecret,
      externalId: "alex",
    });

    const created = await createCustomerTask({
      credentialSecret: app.backendSecret,
      customerId: customer.customerId!,
      agentId: agent.agentId,
      intent: "Do something",
      connectorBindings: [],
    });
    const taskId = created.taskId!;
    taskIds.push(taskId);

    const previousOpenAi = process.env.OPENAI_API_KEY;
    const previousOpenRouter = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const result = await prepareTask({ credentialSecret: app.backendSecret, taskId, generate: true });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.outcome.status).toBe("ai_unavailable");
    } finally {
      if (previousOpenAi !== undefined) process.env.OPENAI_API_KEY = previousOpenAi;
      if (previousOpenRouter !== undefined) process.env.OPENROUTER_API_KEY = previousOpenRouter;
    }
  });
});
