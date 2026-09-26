import { expect, test } from "@playwright/test";

import { managementQuery } from "../integration/support";

const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";
const FIXTURE_ID_PREFIX = "99991000-0000-4000-8000-00000000000";

/**
 * Part 4's runtime authorization endpoint, end to end through the real UI
 * and a real HTTP call: activate a read-only contract exactly the way
 * contract-activation.spec.ts does, issue a runtime credential from the
 * agent page, then call `POST /api/v1/authorize` with it — no Supabase
 * session, exactly as a real agent would. pgTAP suite 17 already covers the
 * exhaustive security-check matrix directly against the database; this
 * suite's job is only to prove the real route handler and real UI wire up
 * to that RPC correctly.
 */
test.describe.serial("runtime authorization", () => {
  let taskId = "";
  let agentId = "";

  test.beforeAll(async () => {
    await managementQuery(`
      begin;

      insert into public.principals (id, tenant_id, kind, display_name, user_id)
      values ('${FIXTURE_ID_PREFIX}1', '${TENANT_A_ID}', 'human', 'Runtime Test Owner (owner.a)',
        'a0000000-0000-4000-8000-000000000001')
      on conflict (id) do nothing;

      insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status)
      values ('${FIXTURE_ID_PREFIX}2', '${TENANT_A_ID}', 'runtime-fixture-agent', 'openai', 'gpt', 'x',
        '${FIXTURE_ID_PREFIX}1', 'active')
      on conflict (id) do nothing;

      insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status)
      values ('${FIXTURE_ID_PREFIX}3', '${TENANT_A_ID}', '${FIXTURE_ID_PREFIX}2', '${FIXTURE_ID_PREFIX}1',
        'Runtime authorization e2e fixture: read the issue, nothing else', 'pending')
      on conflict (id) do nothing;

      commit;
    `);
    taskId = `${FIXTURE_ID_PREFIX}3`;
    agentId = `${FIXTURE_ID_PREFIX}2`;
  });

  test.afterAll(async () => {
    await managementQuery(`
      begin;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.semantic_shadow_evaluations where task_id = '${taskId}';
      delete from public.execution_events where task_id = '${taskId}';
      delete from public.authorization_decisions where task_id = '${taskId}';
      delete from public.capabilities where task_id = '${taskId}';
      delete from public.tool_requests where task_id = '${taskId}';
      delete from public.agent_auth_events where agent_id = '${agentId}';
      delete from public.agent_credentials where agent_id = '${agentId}';
      delete from public.contract_compilations where task_id = '${taskId}';
      delete from public.task_authority_contracts where task_id = '${taskId}';
      delete from public.plan_nodes where plan_id in (select id from public.plans where task_id = '${taskId}');
      delete from public.plans where task_id = '${taskId}';
      delete from public.tasks where id = '${taskId}';
      delete from public.agents where id = '${agentId}';
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

  test("activate a contract, issue a credential, and call the runtime endpoint", async ({
    page,
    request,
  }) => {
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
          maxInvocations: 5,
        },
      ],
    });
    await page.locator("#candidate-plan-json").fill(readOnlyPlan);
    await page.getByRole("button", { name: "Validate" }).click();
    await expect(page.locator("#plan-findings")).toBeVisible();
    await page.getByRole("button", { name: "Propose contract" }).click();
    await expect(page.locator("#contract-proposal")).toBeVisible();
    await page.getByRole("button", { name: "View the task and its proposed contract" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/tasks/${taskId}$`));
    await page.getByRole("button", { name: "Activate" }).click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();

    // Issue a runtime credential from the agent's own page.
    await page.goto(`/app/agents/${agentId}`);
    await page.getByRole("button", { name: "Issue credential" }).click();
    const secretLocator = page.getByText(/^authority_rk_/);
    await expect(secretLocator).toBeVisible();
    const secret = (await secretLocator.textContent())?.trim();
    expect(secret).toMatch(/^authority_rk_[0-9a-f]+$/);

    // No credential at all.
    const missingAuth = await request.post("/api/v1/authorize", {
      data: { taskId, tool: "github.get_issue", operation: "get_issue", idempotencyKey: "e2e-missing" },
    });
    expect(missingAuth.status()).toBe(401);

    // A garbage credential.
    const badAuth = await request.post("/api/v1/authorize", {
      headers: { authorization: "Bearer not-a-real-secret" },
      data: { taskId, tool: "github.get_issue", operation: "get_issue", idempotencyKey: "e2e-bad" },
    });
    expect(badAuth.status()).toBe(401);

    // The real call.
    const allowed = await request.post("/api/v1/authorize", {
      headers: { authorization: `Bearer ${secret}` },
      data: {
        taskId,
        tool: "github.get_issue",
        operation: "get_issue",
        resource: "issue-1",
        arguments: { issue_number: "1" },
        idempotencyKey: "e2e-allow-1",
      },
    });
    expect(allowed.status()).toBe(200);
    const allowedBody = await allowed.json();
    expect(allowedBody.status).toBe("allow_constrained");
    expect(allowedBody.wasReplayed).toBe(false);
    expect(allowedBody).not.toHaveProperty("credential");
    expect(JSON.stringify(allowedBody)).not.toContain(secret);

    // Idempotent replay of the exact same call.
    const replayed = await request.post("/api/v1/authorize", {
      headers: { authorization: `Bearer ${secret}` },
      data: {
        taskId,
        tool: "github.get_issue",
        operation: "get_issue",
        resource: "issue-1",
        arguments: { issue_number: "1" },
        idempotencyKey: "e2e-allow-1",
      },
    });
    expect(replayed.status()).toBe(200);
    const replayedBody = await replayed.json();
    expect(replayedBody.decisionId).toBe(allowedBody.decisionId);
    expect(replayedBody.wasReplayed).toBe(true);

    // A tool that was never part of the contract.
    const replan = await request.post("/api/v1/authorize", {
      headers: { authorization: `Bearer ${secret}` },
      data: { taskId, tool: "github.delete_repo", operation: "delete_repo", idempotencyKey: "e2e-replan" },
    });
    expect(replan.status()).toBe(200);
    expect((await replan.json()).status).toBe("replan");

    // Shows up in the runtime dashboard.
    await page.goto("/app/runtime");
    await expect(page.locator("tbody").getByText("github.get_issue").first()).toBeVisible();

    // Revoke the credential from the UI, then confirm it can no longer authorize anything.
    await page.goto(`/app/agents/${agentId}`);
    await page.getByRole("button", { name: "Revoke" }).click();
    await page.getByPlaceholder("Revocation reason").fill("e2e cleanup");
    await page.getByRole("button", { name: "Confirm revoke" }).click();
    await expect(page.getByText("revoked", { exact: true })).toBeVisible();

    const afterRevoke = await request.post("/api/v1/authorize", {
      headers: { authorization: `Bearer ${secret}` },
      data: { taskId, tool: "github.get_issue", operation: "get_issue", idempotencyKey: "e2e-after-revoke" },
    });
    expect(afterRevoke.status()).toBe(401);
  });
});
