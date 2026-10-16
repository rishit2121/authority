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
 * plan and get a running contract back without a dashboard click, unless one
 * of the organization's approval rules (20261015000002) matches something
 * the plan includes -- then the contract waits for a person.
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
    insert into public.applications (id, tenant_id, name, slug, require_task_sessions) values ('${applicationId}', '${TENANT_A_ID}', 'Task lifecycle test app', 'tlt-${suffix}', false);

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
        delete from public.developer_backend_credentials where application_id = '${applicationId}';
        delete from public.customers where application_id = '${applicationId}';
        delete from public.applications where id = '${applicationId}';
      `);
    },
  };
}

/** An approval rule for the shared test tenant; integration files run one at a time, and the caller removes it. */
async function addApprovalRule(name: string, key: string, matches: string): Promise<string> {
  const rows = (await managementQuery(`
    insert into public.policies (tenant_id, name, status, effect, conditions, required_approval_role, activated_at)
    values ('${TENANT_A_ID}', '${name}', 'active', 'require_approval',
            '{"schemaVersion":1,"rules":[{"key":"${key}","matches":"${matches}"}]}', 'admin', now())
    returning id;
  `)) as { id: string }[];
  return rows[0].id;
}

async function removeApprovalRule(id: string): Promise<void> {
  await managementQuery(`
    set local role postgres;
    select set_config('authority.allow_demo_purge', 'on', true);
    delete from public.policies where id = '${id}';
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

  it("activates automatically when no approval rule matches -- and is idempotent on repeat", async () => {
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
    const plan = planFor(taskId, "github.get_issue", { issue_number: "1" }, { resourceBinding: "1" });

    const first = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan, idempotencyKey });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.outcome.status).toBe("ready");
    if (first.outcome.status !== "ready") return;
    const contractId = first.outcome.contractId;
    expect(first.outcome.tools).toEqual(["github.get_issue"]);

    const contract = await getContractForBackend(app.backendSecret, contractId);
    expect(contract.contractStatus).toBe("active");
    expect(contract.requiredApprovalsCount).toBe(0);

    // Same idempotency key, same plan content: the exact same plan and
    // contract row (never a second version), still ready.
    const second = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan, idempotencyKey });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.outcome.status).toBe("ready");
    if (second.outcome.status !== "ready") return;
    expect(second.outcome.contractId).toBe(contractId);

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

  it("never reports an expired contract as ready again, even though the dead row's identity is permanently reused", async () => {
    // Regression for a real bug found via a live model-driven-agent run
    // against the deployed service: activate_task_contract_for_backend's
    // idempotent short-circuit (20261003000016) checked contract_status but
    // never expires_at, so prepare() kept reporting "ready" with a dead
    // contractId that the real runtime execute() path (which does check
    // expiry) immediately rejected. A first attempt at fixing this
    // (20261003000018) also made propose_task_contract_core fall through to
    // INSERT a fresh row once the matched one had expired -- but
    // tac_compilation_identity_idx (task_id, plan_id, registry_version,
    // compiler_version, input_hash) is a permanent, status-independent
    // unique mapping, so that INSERT always collides with the still-present
    // dead row (23505) -- discovered live, immediately, as prepare() now
    // failing outright with 503 instead of mis-reporting. Reverted in
    // 20261003000019: propose_task_contract_core unconditionally reuses the
    // existing row by identity (as it always did), and only
    // activate_task_contract_for_backend's expiry-aware check (kept from
    // 018) stops the false "ready" -- the honest, schema-compatible result
    // is the SAME contractId with status "awaiting_approval", never "ready"
    // again, for an expired contract.
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
    // window via the one lifecycle transition that can represent it
    // (active -> expired) -- the contract_authority_contracts_lifecycle
    // trigger (20260926000004) forbids touching expires_at directly without
    // an accompanying status transition ("lifecycle metadata may only
    // change alongside a status transition"), so this is the only
    // trigger-legal way to make authz.contract_is_currently_active return
    // false for this row, exactly as it would once real time passed.
    await managementQuery(`
      update public.task_authority_contracts
      set contract_status = 'expired'
      where id = '${firstContractId}';
    `);

    // Must not throw (the 23505 regression) and must not report "ready".
    const second = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan, idempotencyKey });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.outcome.status).toBe("awaiting_approval");
    if (second.outcome.status !== "awaiting_approval") return;
    expect(second.outcome.contractId).toBe(firstContractId);

    const afterExpiry = await getContractForBackend(app.backendSecret, firstContractId);
    expect(afterExpiry.contractStatus).toBe("expired");
  });

  it("a fresh run (new task, new idempotency key) reaches ready again for the same customer and connection after an earlier run's contract expired", async () => {
    // Proves the actual, usable escape hatch from the previous test's dead
    // end: this schema cannot resurrect or replace a specific expired
    // contract (see 20261003000019), but nothing stops a NEW logical run --
    // a new task, carrying its own idempotency key -- for the SAME customer
    // from reaching a genuinely fresh, active contract. This is exactly
    // what examples/connector-quickstart and examples/model-driven-agent now do
    // via their own RUN_ID (a fresh one by default, reusable to resume a
    // specific prior run).
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);
    const agent = await mkAgent("lifecycle-repeat");
    const customer = await createOrResolveCustomer({
      credentialSecret: app.backendSecret,
      externalId: "alex",
    });
    async function runOnce(runId: string) {
      const created = await createCustomerTask({
        credentialSecret: app.backendSecret,
        customerId: customer.customerId!,
        agentId: agent.agentId,
        intent: `List my Gmail labels (run ${runId})`,
        connectorBindings: [],
        idempotencyKey: `repeat-task-${suffix}-${runId}`,
      });
      const taskId = created.taskId!;
      taskIds.push(taskId);
      const plan = planFor(taskId, "gmail.list_labels", {});
      const result = await prepareTask({
        credentialSecret: app.backendSecret,
        taskId,
        plan,
        idempotencyKey: `repeat-prepare-${suffix}-${runId}`,
      });
      return { taskId, result };
    }

    const run1 = await runOnce("run-1");
    expect(run1.result.ok).toBe(true);
    if (!run1.result.ok) return;
    expect(run1.result.outcome.status).toBe("ready");
    if (run1.result.outcome.status !== "ready") return;

    // Retrying the SAME run id is idempotent: same task, same contract.
    const run1Retry = await runOnce("run-1");
    expect(run1Retry.result.ok).toBe(true);
    if (!run1Retry.result.ok) return;
    expect(run1Retry.result.outcome.status).toBe("ready");
    if (run1Retry.result.outcome.status !== "ready") return;
    expect(run1Retry.taskId).toBe(run1.taskId);
    expect(run1Retry.result.outcome.contractId).toBe(run1.result.outcome.contractId);

    // Expire run 1's contract via the one trigger-legal transition that can
    // represent real time having passed (see the comment on the same
    // pattern above).
    await managementQuery(`
      update public.task_authority_contracts
      set contract_status = 'expired'
      where id = '${run1.result.outcome.contractId}';
    `);

    // A second, independent logical run for the SAME customer and the SAME
    // underlying Gmail connection reaches ready again, with its own task
    // and its own contract -- run 1's expiry never touches it.
    const run2 = await runOnce("run-2");
    expect(run2.result.ok).toBe(true);
    if (!run2.result.ok) return;
    expect(run2.result.outcome.status).toBe("ready");
    if (run2.result.outcome.status !== "ready") return;
    expect(run2.taskId).not.toBe(run1.taskId);
    expect(run2.result.outcome.contractId).not.toBe(run1.result.outcome.contractId);

    const run2Contract = await getContractForBackend(app.backendSecret, run2.result.outcome.contractId);
    expect(run2Contract.contractStatus).toBe("active");
  });

  it("a gmail.list_labels-only plan solves with zero excess operations and reaches ready", async () => {
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

  it("waits for a person only while an approval rule matches the plan", async () => {
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);
    const agent = await mkAgent("lifecycle-approval");
    const customer = await createOrResolveCustomer({
      credentialSecret: app.backendSecret,
      externalId: "alex",
    });

    const refundTask = async (run: string) => {
      const created = await createCustomerTask({
        credentialSecret: app.backendSecret,
        customerId: customer.customerId!,
        agentId: agent.agentId,
        intent: `Refund a Stripe payment (${run})`,
        connectorBindings: [],
      });
      expect(created.status).toBe("ok");
      const taskId = created.taskId!;
      taskIds.push(taskId);
      const plan = planFor(
        taskId,
        "stripe.issue_refund",
        { payment_id: "pi_test123", amount_cents: 500 },
        { resourceBinding: "pi_test123", expectedSideEffect: "write_create" },
      );
      const result = await prepareTask({ credentialSecret: app.backendSecret, taskId, plan });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("prepare failed");
      return result.outcome;
    };

    // No rule: a refund -- a write that moves money -- starts right away.
    expect((await refundTask("no rule")).status).toBe("ready");

    // A rule for money movement: the same kind of task now waits for a person.
    const ruleId = await addApprovalRule(`Money movement ${suffix}`, "action", "money");
    try {
      const held = await refundTask("with rule");
      expect(held.status).toBe("awaiting_approval");
      if (held.status !== "awaiting_approval") return;
      const contract = await getContractForBackend(app.backendSecret, held.contractId);
      expect(contract.contractStatus).toBe("proposed");
      expect(contract.requiredApprovalsCount).toBe(1);

      // A read is untouched by a money rule.
      const created = await createCustomerTask({
        credentialSecret: app.backendSecret,
        customerId: customer.customerId!,
        agentId: agent.agentId,
        intent: "List my Gmail labels (with a money rule)",
        connectorBindings: [],
      });
      taskIds.push(created.taskId!);
      const read = await prepareTask({
        credentialSecret: app.backendSecret,
        taskId: created.taskId!,
        plan: planFor(created.taskId!, "gmail.list_labels", {}),
      });
      expect(read.ok && read.outcome.status).toBe("ready");
    } finally {
      await removeApprovalRule(ruleId);
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

  it("answers a plan whose step depends on itself with clarification, not a 500", async () => {
    // A real AI planner produced exactly this (found by the playground's
    // evaluation console): it passes the schema but fails structural checks.
    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);
    const agent = await mkAgent("lifecycle-self-ref");
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

    const result = await prepareTask({
      credentialSecret: app.backendSecret,
      taskId,
      plan: {
        schemaVersion: 1,
        taskId,
        nodes: [
          {
            id: "node1",
            sequence: 1,
            tool: "gmail.list_labels",
            arguments: {},
            declaredOutputs: ["labels"],
            dataFlowRefs: [{ argumentKey: "label", fromNodeId: "node1", output: "labels" }],
            expectedSideEffect: "read",
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.status).toBe("clarification");
    if (result.outcome.status === "clarification") expect(result.outcome.reason).toMatch(/malformed/);
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
