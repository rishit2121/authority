import { expect, test } from "@playwright/test";

import { managementQuery } from "../integration/support";

const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";
const FIXTURE_ID_PREFIX = "77770000-0000-4000-8000-00000000000";

/**
 * The kill-switch flow, against a task created solely for this suite.
 *
 * `terminate_task()` is a real, persisted mutation as of Part 2B.2 — it is
 * no longer client-side state standing in for one. That matters for test
 * isolation: the shared GitHub #991 demo task is read by several other
 * suites (marketing.spec.ts, accessibility-layout.spec.ts), which all run
 * concurrently with this one under Playwright's `fullyParallel` setting.
 * Terminating that shared task here would race with — and corrupt — every
 * one of them. This suite creates and destroys its own fixture task instead,
 * so it can run at any time relative to anything else without touching
 * state anyone else depends on.
 */
test.describe.serial("kill switch", () => {
  let taskId = "";

  test.beforeAll(async () => {
    // Runs as postgres (the Management API's default), not as authenticated
    // — principals/agents/tasks/... hold no INSERT grant for authenticated
    // at all outside agents (developer+) by design (see
    // 20260923000008_product_rls.sql); this is privileged fixture setup,
    // exactly like the pgTAP suites' own fixtures, not a client action.
    await managementQuery(`
      begin;

      insert into public.principals (id, tenant_id, kind, display_name)
      values ('${FIXTURE_ID_PREFIX}1', '${TENANT_A_ID}', 'human', 'Kill Switch Test Principal')
      on conflict (id) do nothing;

      insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status)
      values ('${FIXTURE_ID_PREFIX}2', '${TENANT_A_ID}', 'kill-switch-fixture-agent', 'openai', 'gpt', 'x',
        '${FIXTURE_ID_PREFIX}1', 'active')
      on conflict (id) do nothing;

      insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status)
      values ('${FIXTURE_ID_PREFIX}3', '${TENANT_A_ID}', '${FIXTURE_ID_PREFIX}2', '${FIXTURE_ID_PREFIX}1',
        'Kill switch e2e fixture task', 'executing')
      on conflict (id) do nothing;

      insert into public.plans (id, tenant_id, task_id, input_hash)
      values ('${FIXTURE_ID_PREFIX}8', '${TENANT_A_ID}', '${FIXTURE_ID_PREFIX}3', repeat('9', 64))
      on conflict (id) do nothing;

      -- The domain's Plan schema requires at least one node (see
      -- lib/domain/plan.ts) — the task page reads this plan through that
      -- mapper, not just through pgTAP's raw-SQL checks, so an empty plan
      -- would fail to render at all.
      insert into public.plan_nodes (
        tenant_id, plan_id, node_key, sequence_no, tool, operation, resource, status,
        declared_outputs, data_flow_refs, max_invocations
      ) values (
        '${TENANT_A_ID}', '${FIXTURE_ID_PREFIX}8', 'read-issue', 0, 'github.read_issue', 'read_issue',
        'payments-api#991', 'executed',
        '{"schemaVersion":1,"outputs":[]}', '{"schemaVersion":1,"refs":[]}', 1
      )
      on conflict (plan_id, node_key) do nothing;

      insert into public.task_authority_contracts (
        id, tenant_id, task_id, plan_id, spec_version, allowed_actions, ephemeral_limits, contract_status,
        registry_version, compiler_version, input_hash, output_hash, data_flow_bindings, required_approvals
      ) values (
        '${FIXTURE_ID_PREFIX}4', '${TENANT_A_ID}', '${FIXTURE_ID_PREFIX}3', '${FIXTURE_ID_PREFIX}8', 'v1',
        '{"schemaVersion":1,"items":[{"tool":"github.read_issue","constraints":[]}]}',
        '{"schemaVersion":1,"maxToolInvocations":5,"expiresInSeconds":60}', 'active',
        'fixture-registry', 'fixture-compiler', repeat('a', 64), repeat('b', 64),
        '{"schemaVersion":1,"refs":[]}', '{"schemaVersion":1,"items":[]}'
      )
      on conflict (id) do nothing;

      insert into public.tool_requests (id, tenant_id, task_id, agent_id, tool, operation, normalized_arguments, idempotency_key)
      values ('${FIXTURE_ID_PREFIX}5', '${TENANT_A_ID}', '${FIXTURE_ID_PREFIX}3', '${FIXTURE_ID_PREFIX}2',
        'github.read_issue', 'read_issue', '{"schemaVersion":1,"values":{}}', 'kill-switch-fixture-key')
      on conflict (id) do nothing;

      insert into public.authorization_decisions (
        id, tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome,
        reason_codes, applied_constraints, latency_ms
      ) values (
        '${FIXTURE_ID_PREFIX}6', '${TENANT_A_ID}', '${FIXTURE_ID_PREFIX}3', '${FIXTURE_ID_PREFIX}5',
        '${FIXTURE_ID_PREFIX}4', 1, 'allow',
        '{"schemaVersion":1,"items":[{"code":"WITHIN_CONTRACT","detail":"Fixture.","source":"contract"}]}',
        '{"schemaVersion":1,"items":[]}', 1
      )
      on conflict (id) do nothing;

      insert into public.capabilities (
        id, tenant_id, task_id, authorization_decision_id, agent_id, tool, max_invocations, expires_at, status
      ) values (
        '${FIXTURE_ID_PREFIX}7', '${TENANT_A_ID}', '${FIXTURE_ID_PREFIX}3', '${FIXTURE_ID_PREFIX}6',
        '${FIXTURE_ID_PREFIX}2', 'github.read_issue', 3, now() + interval '1 hour', 'active'
      )
      on conflict (id) do nothing;

      insert into public.execution_events (tenant_id, task_id, event_type, result_status, summary)
      values ('${TENANT_A_ID}', '${FIXTURE_ID_PREFIX}3', 'task_received', 'info', 'Fixture task received.')
      on conflict do nothing;

      commit;
    `);
    taskId = `${FIXTURE_ID_PREFIX}3`;
  });

  test.afterAll(async () => {
    // Scoped to exactly this fixture's own ids — never the shared demo
    // data — using the same escape hatch reset_demo_workspace() relies on,
    // since these rows carry no demo_key for that RPC to find.
    await managementQuery(`
      begin;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.execution_events where task_id = '${FIXTURE_ID_PREFIX}3';
      delete from public.capabilities where task_id = '${FIXTURE_ID_PREFIX}3';
      delete from public.authorization_decisions where task_id = '${FIXTURE_ID_PREFIX}3';
      delete from public.tool_requests where task_id = '${FIXTURE_ID_PREFIX}3';
      delete from public.task_authority_contracts where task_id = '${FIXTURE_ID_PREFIX}3';
      delete from public.plan_nodes where plan_id = '${FIXTURE_ID_PREFIX}8';
      delete from public.plans where task_id = '${FIXTURE_ID_PREFIX}3';
      delete from public.tasks where id = '${FIXTURE_ID_PREFIX}3';
      delete from public.agents where id = '${FIXTURE_ID_PREFIX}2';
      delete from public.principals where id = '${FIXTURE_ID_PREFIX}1';
      commit;
    `);
  });

  test("task starts executing with active capabilities", async ({ page }) => {
    await page.goto(`/app/tasks/${taskId}`);
    await expect(page.getByText("executing", { exact: true })).toBeVisible();

    const capabilities = page.locator("#capabilities");
    await expect(capabilities.getByText("active", { exact: true }).first()).toBeVisible();
  });

  test("cancelling the confirmation changes nothing", async ({ page }) => {
    await page.goto(`/app/tasks/${taskId}`);

    await page.getByRole("button", { name: "Revoke all authority" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();

    // Still executing, kill switch still armed rather than fired.
    await expect(page.getByText("executing", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Revoke all authority" })).toBeVisible();
    await expect(page.getByText("Task terminated")).toBeHidden();
  });

  test("confirming persists termination, revokes capabilities, and appends one event", async ({ page }) => {
    await page.goto(`/app/tasks/${taskId}`);
    const taskUrl = page.url();

    const capabilities = page.locator("#capabilities");
    const timeline = page.locator("#timeline");
    const timelineEventsBefore = await timeline.getByRole("listitem").count();
    const activeBefore = await capabilities.getByText("active", { exact: true }).count();
    expect(activeBefore).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Revoke all authority" }).click();
    await page.getByRole("button", { name: "Confirm revocation" }).click();

    // Task becomes terminated.
    await expect(page.getByRole("heading", { name: "Task terminated" })).toBeVisible();
    await expect(page.getByText("terminated", { exact: true })).toBeVisible();

    // Every previously-active capability is now revoked.
    await expect(capabilities.getByText("active", { exact: true })).toHaveCount(0);
    await expect(capabilities.getByText("revoked").first()).toBeVisible();

    // Execution timeline gains exactly one event, from the real RPC.
    await expect(timeline.getByRole("listitem")).toHaveCount(timelineEventsBefore + 1);
    await expect(timeline.getByText(/operator terminated the task from the control plane/i)).toBeVisible();

    // States plainly that nothing external was contacted — and that the
    // mutation itself is real, unlike Part 1's local-state-only control.
    await expect(page.getByText(/no external system or agent was contacted/i)).toBeVisible();
    await expect(page.getByText(/persisted in authority.s own database/i)).toBeVisible();

    // The persistence claim, checked directly: reload without any client
    // state must still show terminated.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Task terminated" })).toBeVisible();
    await expect(capabilities.getByText("active", { exact: true })).toHaveCount(0);

    // Repeated termination is idempotent: the button that would re-trigger
    // it is gone once terminated, and revisiting the same URL is safe.
    await page.goto(taskUrl);
    await expect(page.getByRole("heading", { name: "Task terminated" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Revoke all authority" })).toHaveCount(0);
  });
});
