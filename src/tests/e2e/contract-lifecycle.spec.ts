import { expect, test } from "@playwright/test";

import { managementQuery } from "../integration/support";

const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";
const FIXTURE_ID_PREFIX = "88880000-0000-4000-8000-00000000000";

/**
 * Part 3A's candidate-plan / contract-proposal workflow, end to end through
 * the real UI, against a fixture task created solely for this suite — never
 * the shared GitHub #991 demo task other suites read concurrently under
 * Playwright's `fullyParallel` setting (see kill-switch.spec.ts for the same
 * reasoning). This suite never activates a contract: there is no client
 * path that does, by design, so the strongest assertion available is that
 * the contract stays out of the `active` state through every step here,
 * exactly like pgTAP's 14_contract_lifecycle.sql.
 */
test.describe.serial("candidate plan / contract lifecycle", () => {
  let taskId = "";

  test.beforeAll(async () => {
    await managementQuery(`
      begin;

      insert into public.principals (id, tenant_id, kind, display_name)
      values ('${FIXTURE_ID_PREFIX}1', '${TENANT_A_ID}', 'human', 'Contract Lifecycle Test Principal')
      on conflict (id) do nothing;

      insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status)
      values ('${FIXTURE_ID_PREFIX}2', '${TENANT_A_ID}', 'contract-lifecycle-fixture-agent', 'openai', 'gpt', 'x',
        '${FIXTURE_ID_PREFIX}1', 'active')
      on conflict (id) do nothing;

      insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status)
      values ('${FIXTURE_ID_PREFIX}3', '${TENANT_A_ID}', '${FIXTURE_ID_PREFIX}2', '${FIXTURE_ID_PREFIX}1',
        'Contract lifecycle e2e fixture: resolve issue #991 in payments-api', 'pending')
      on conflict (id) do nothing;

      commit;
    `);
    taskId = `${FIXTURE_ID_PREFIX}3`;
  });

  test.afterAll(async () => {
    // Scoped to exactly this fixture's own ids, using the same escape hatch
    // reset_demo_workspace() relies on, since these rows carry no demo_key.
    await managementQuery(`
      begin;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.contract_compilations where contract_id in (
        select id from public.task_authority_contracts where task_id = '${FIXTURE_ID_PREFIX}3'
      );
      delete from public.task_authority_contracts where task_id = '${FIXTURE_ID_PREFIX}3';
      delete from public.plan_nodes where plan_id in (
        select id from public.plans where task_id = '${FIXTURE_ID_PREFIX}3'
      );
      delete from public.plans where task_id = '${FIXTURE_ID_PREFIX}3';
      delete from public.tasks where id = '${FIXTURE_ID_PREFIX}3';
      delete from public.agents where id = '${FIXTURE_ID_PREFIX}2';
      delete from public.principals where id = '${FIXTURE_ID_PREFIX}1';
      commit;
    `);
  });

  test("no contract yet shows the pending panel with a create CTA", async ({ page }) => {
    await page.goto(`/app/tasks/${taskId}`);
    await expect(page.getByRole("heading", { name: "Task Authority Contract" })).toBeVisible();
    await expect(page.getByText(/no contract has been proposed for this task yet/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Create authority contract" })).toBeVisible();
  });

  test("validating the example plan reports per-node findings, including a policy denial", async ({
    page,
  }) => {
    await page.goto(`/app/tasks/${taskId}/contract/new`);
    await expect(page.getByRole("heading", { name: "Create authority contract" })).toBeVisible();

    // The textarea is pre-filled by "Load the GitHub #991 example" on mount;
    // this exercises that path directly rather than duplicating the fixture
    // JSON inline in the test.
    await expect(page.locator("#candidate-plan-json")).toHaveValue(new RegExp(taskId));

    await page.getByRole("button", { name: "Validate" }).click();

    const findings = page.locator("#plan-findings");
    await expect(findings).toBeVisible();
    await expect(findings.getByText("3 of 4 nodes accepted")).toBeVisible();

    await expect(
      findings.locator("li", { hasText: "read-issue" }).getByText("accepted", { exact: true }),
    ).toBeVisible();
    await expect(
      findings.locator("li", { hasText: "create-branch" }).getByText("accepted", { exact: true }),
    ).toBeVisible();
    await expect(
      findings.locator("li", { hasText: "push-commit" }).getByText("accepted", { exact: true }),
    ).toBeVisible();

    // The forbidden-secrets node is denied by the demo tenant's active
    // policy — never silently dropped, never auto-corrected.
    const secretFinding = findings.locator("li", { hasText: "get-secret" });
    await expect(secretFinding.getByText("denied", { exact: true })).toBeVisible();
    await expect(
      secretFinding.getByText(/forbidden by policy "Never read repository secrets"/i),
    ).toBeVisible();

    // "Propose contract" only becomes available once validation has run and
    // found at least one accepted node.
    await expect(page.getByRole("button", { name: "Propose contract" })).toBeEnabled();
  });

  test("proposing a contract shows the minimum permissions and excess operations, and persists as not-active", async ({
    page,
  }) => {
    await page.goto(`/app/tasks/${taskId}/contract/new`);
    await page.getByRole("button", { name: "Validate" }).click();
    await expect(page.locator("#plan-findings")).toBeVisible();

    await page.getByRole("button", { name: "Propose contract" }).click();

    const proposal = page.locator("#contract-proposal");
    await expect(proposal).toBeVisible();
    await expect(proposal.getByRole("heading", { name: "Contract proposed — not active" })).toBeVisible();

    // The solver must select permissions covering the three accepted
    // operations and nothing that only the denied secret-read node needed.
    await expect(proposal.getByText("github.issues_read")).toBeVisible();
    await expect(proposal.getByText(/secrets_read/)).toHaveCount(0);

    await page.getByRole("button", { name: "View the task and its proposed contract" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/tasks/${taskId}$`));

    // Persisted, and visibly not active.
    await expect(page.getByText("Proposed — not active", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/this contract grants no runtime authority while it is not active/i),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit for approval" })).toBeVisible();

    // Reload without any client state must still show the same, persisted status.
    await page.reload();
    await expect(page.getByText("Proposed — not active", { exact: true })).toBeVisible();
  });

  test("submitting for approval and then rejecting moves the contract through its lifecycle, never through active", async ({
    page,
  }) => {
    await page.goto(`/app/tasks/${taskId}`);

    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.getByText("Awaiting approval — not active", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Reject" }).click();
    await page.getByLabel("Rejection reason").fill("Scope creep — not needed for this task.");
    await page.getByRole("button", { name: "Confirm rejection" }).click();

    await expect(page.getByText("Rejected — not active", { exact: true })).toBeVisible();
    await expect(page.getByText(/Rejected: Scope creep — not needed for this task\./)).toBeVisible();

    // No lifecycle action remains on a rejected contract; re-proposing is
    // the only way forward, and it always starts a new version.
    await expect(page.getByRole("button", { name: "Submit for approval" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Create authority contract" })).toBeVisible();

    // Reload confirms this is real, persisted state, not client-side guesswork.
    await page.reload();
    await expect(page.getByText("Rejected — not active", { exact: true })).toBeVisible();
  });
});
