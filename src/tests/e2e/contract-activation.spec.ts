import { expect, test } from "@playwright/test";

import { managementQuery } from "../integration/support";

const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";
const FIXTURE_ID_PREFIX = "99990000-0000-4000-8000-00000000000";

/**
 * Part 3B's activation workflow, end to end through the real UI: propose a
 * plan whose only node is read-only (so it needs zero approvals and can
 * activate directly), confirm it goes active, confirm the single-active-
 * per-task invariant holds for a superseding second version, then revoke.
 *
 * The fixture task's own principal is linked to owner.a's real auth id, so
 * the same signed-in session can submit, approve as the task's own owner,
 * and activate (owner.a is admin+) — exercising the whole lifecycle without
 * juggling multiple signed-in sessions, which Playwright can't do within a
 * single browser context anyway. pgTAP suite 16 already covers the
 * multi-principal self-approval and distinct-approver cases directly
 * against the database; this suite's job is only to prove the real UI wires
 * up to the real actions correctly.
 */
test.describe.serial("contract activation", () => {
  let taskId = "";

  test.beforeAll(async () => {
    await managementQuery(`
      begin;

      insert into public.principals (id, tenant_id, kind, display_name, user_id)
      values ('${FIXTURE_ID_PREFIX}1', '${TENANT_A_ID}', 'human', 'Activation Test Owner (owner.a)',
        'a0000000-0000-4000-8000-000000000001')
      on conflict (id) do nothing;

      insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status)
      values ('${FIXTURE_ID_PREFIX}2', '${TENANT_A_ID}', 'activation-fixture-agent', 'openai', 'gpt', 'x',
        '${FIXTURE_ID_PREFIX}1', 'active')
      on conflict (id) do nothing;

      insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status)
      values ('${FIXTURE_ID_PREFIX}3', '${TENANT_A_ID}', '${FIXTURE_ID_PREFIX}2', '${FIXTURE_ID_PREFIX}1',
        'Contract activation e2e fixture: read the issue, nothing else', 'pending')
      on conflict (id) do nothing;

      commit;
    `);
    taskId = `${FIXTURE_ID_PREFIX}3`;
  });

  test.afterAll(async () => {
    await managementQuery(`
      begin;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.approvals where contract_id in (
        select id from public.task_authority_contracts where task_id = '${FIXTURE_ID_PREFIX}3'
      );
      delete from public.contract_compilations where task_id = '${FIXTURE_ID_PREFIX}3';
      delete from public.task_authority_contracts where task_id = '${FIXTURE_ID_PREFIX}3';
      delete from public.plan_nodes where plan_id in (
        select id from public.plans where task_id = '${FIXTURE_ID_PREFIX}3'
      );
      delete from public.plans where task_id = '${FIXTURE_ID_PREFIX}3';
      delete from public.tasks where id = '${FIXTURE_ID_PREFIX}3';
      delete from public.agents where id = '${FIXTURE_ID_PREFIX}2';
      -- Conditional: activate_task_contract() attributes activation to whichever of the
      -- user's principals it finds first, so a parallel spec's contract may reference
      -- this fixture principal. Delete it only when nothing else does.
      delete from public.principals p where p.id = '${FIXTURE_ID_PREFIX}1'
        and not exists (select 1 from public.task_authority_contracts c
          where p.id in (c.activated_by_principal_id, c.submitted_by_principal_id, c.rejected_by_principal_id, c.revoked_by_principal_id))
        and not exists (select 1 from public.approvals a where a.responded_by_principal_id = p.id);
      commit;
    `);
  });

  test("a read-only plan needs no approval and activates directly", async ({ page }) => {
    await page.goto(`/app/tasks/${taskId}/contract/new`);

    const readOnlyPlan = JSON.stringify({
      schemaVersion: 1,
      taskId,
      nodes: [
        {
          id: "read-issue",
          sequence: 0,
          tool: "github.get_issue",
          arguments: { issue_number: "1" },
          dependencies: [],
          declaredOutputs: [],
          dataFlowRefs: [],
          expectedSideEffect: "read",
          maxInvocations: 1,
        },
      ],
    });
    await page.locator("#candidate-plan-json").fill(readOnlyPlan);

    await page.getByRole("button", { name: "Validate" }).click();
    await expect(page.locator("#plan-findings")).toBeVisible();
    await expect(page.locator("#plan-findings").getByText("1 of 1 nodes accepted")).toBeVisible();

    await page.getByRole("button", { name: "Propose contract" }).click();
    const proposal = page.locator("#contract-proposal");
    await expect(proposal).toBeVisible();

    await page.getByRole("button", { name: "View the task and its proposed contract" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/tasks/${taskId}$`));

    await expect(page.getByText("Proposed — not active", { exact: true })).toBeVisible();
    // No approval requirements at all for a pure-read plan.
    await expect(page.locator("#contract-approvals")).toHaveCount(0);

    await page.getByRole("button", { name: "Activate" }).click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/this contract grants no runtime authority while it is not active/i),
    ).toHaveCount(0);

    // Persistence across reload — this is real, not client-side state.
    await page.reload();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
  });

  test("a second proposed version supersedes the first on activation, never coexisting with it", async ({
    page,
  }) => {
    await page.goto(`/app/tasks/${taskId}/contract/new`);

    const secondPlan = JSON.stringify({
      schemaVersion: 1,
      taskId,
      nodes: [
        {
          id: "read-repo",
          sequence: 0,
          tool: "github.read_repository",
          arguments: { repository: "payments-api" },
          dependencies: [],
          declaredOutputs: [],
          dataFlowRefs: [],
          expectedSideEffect: "read",
          maxInvocations: 1,
        },
      ],
    });
    await page.locator("#candidate-plan-json").fill(secondPlan);
    await page.getByRole("button", { name: "Validate" }).click();
    await expect(page.locator("#plan-findings")).toBeVisible();
    await page.getByRole("button", { name: "Propose contract" }).click();
    await expect(page.locator("#contract-proposal")).toBeVisible();

    await page.goto(`/app/tasks/${taskId}`);
    await expect(page.getByText("Proposed — not active", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Activate" }).click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByText("Superseded", { exact: true })).toHaveCount(0);

    // Reload: still exactly one active contract shown, the new version.
    await page.reload();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
  });

  test("revocation moves the active contract to revoked, and it is visibly no longer authoritative", async ({
    page,
  }) => {
    await page.goto(`/app/tasks/${taskId}`);
    await expect(page.getByText("Active", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await page.getByLabel("Revocation reason").fill("No longer needed for this fixture.");
    await page.getByRole("button", { name: "Confirm revocation" }).click();

    await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
    await expect(page.getByText(/Revoked: No longer needed for this fixture\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Activate" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  });
});
