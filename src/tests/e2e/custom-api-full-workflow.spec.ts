import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { managementQuery, TENANT_A_ID } from "../integration/support";
import { signIn } from "./support/auth";
import { ADMIN_A } from "./support/users";

/**
 * The complete Custom API customer workflow, driven through the real UI and
 * real HTTP calls, end to end: create a connection, configure a credential,
 * define an operation, validate it, publish it, create a task, select the
 * published operation from the plan builder's tool picker, compile the
 * contract's minimum scope, get it approved and activated, authorize and
 * execute one allowed call, then attempt one denied resource substitution --
 * and prove that denied call never reached the fixture API at all.
 *
 * Verification here is against the in-process fixture server
 * (src/lib/connectors/custom-api/fixture-server.ts), gated behind
 * CUSTOM_API_FIXTURE_MODE (set in playwright.config.ts's webServer env) --
 * NOT a real external sandbox account. No real third-party API is involved
 * anywhere in this spec.
 *
 * Only the agent/principal fixture this test runs under is seeded directly
 * (the same accepted pattern runtime-authorization.spec.ts and
 * github-connector.spec.ts already use for THEIR agent/principal fixtures;
 * "create an agent" is not itself one of the customer-facing workflow steps
 * this spec is proving). Every other step -- connection, credential,
 * operation lifecycle, task, plan, contract, approval, activation -- goes
 * through the real UI or the real runtime API a real agent would call.
 */

const RUN = Date.now().toString(36);
const FIXTURE_BASE_URL = "https://custom-api-fixture.authority.test";

async function readFixtureLog(request: APIRequestContext): Promise<{ count: number; paths: string[] }> {
  const res = await request.get("/api/internal/custom-api-fixture");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { requestLog: Array<{ path: string }> };
  return { count: body.requestLog.length, paths: body.requestLog.map((r) => r.path) };
}

async function resetFixture(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/internal/custom-api-fixture", { data: { action: "reset" } });
  expect(res.status()).toBe(200);
}

test.describe.serial("Custom API: complete customer workflow", () => {
  let connectionName: string;
  let agentId = "";
  let principalId = "";
  let taskId = "";

  test.beforeAll(async () => {
    connectionName = `Widget Orders Full Workflow ${RUN}`;
    const rows = (await managementQuery(`
      select id from public.principals where tenant_id = '${TENANT_A_ID}' and user_id = 'a0000000-0000-4000-8000-000000000001';
    `)) as Array<{ id: string }>;
    principalId = rows[0].id;

    const agentRows = (await managementQuery(`
      insert into public.agents (tenant_id, name, model_provider, model, framework, owner_principal_id, status)
      values ('${TENANT_A_ID}', 'custom-api-e2e-agent-${RUN}', 'openai', 'gpt', 'x', '${principalId}', 'active')
      returning id;
    `)) as Array<{ id: string }>;
    agentId = agentRows[0].id;
  });

  test.afterAll(async () => {
    // taskId is only assigned partway through the test body (step 6+); if an
    // earlier step throws, it's still "" here. A multi-statement
    // managementQuery batch runs as one implicit transaction, so a single
    // `where task_id = ''` (invalid uuid syntax) aborted this WHOLE cleanup
    // -- including the connection/operation deletes below, which have
    // nothing to do with the task -- leaking a published custom-api
    // connection into the shared tenant's registry on every run that failed
    // before reaching that step (confirmed: this is exactly what broke
    // mcp-bridge.test.ts and mcp-route.test.ts, unrelated suites, by
    // inflating buildTenantRegistry's computed version for the whole
    // tenant). The connection cleanup no longer depends on whether the task
    // ever got created, and the task-scoped statements are skipped
    // entirely, not sent with an empty id, when it didn't.
    const taskCleanup = taskId
      ? `
      delete from public.capability_consumptions where capability_id in (select id from public.capability_tokens where task_id = '${taskId}');
      delete from public.capability_tokens where task_id = '${taskId}';
      delete from public.final_decisions where task_id = '${taskId}';
      delete from public.execution_events where task_id = '${taskId}';
      delete from public.authorization_decisions where task_id = '${taskId}';
      delete from public.capabilities where task_id = '${taskId}';
      delete from public.tool_requests where task_id = '${taskId}';
      delete from public.approvals where contract_id in (select id from public.task_authority_contracts where task_id = '${taskId}');
      delete from public.contract_compilations where task_id = '${taskId}';
      delete from public.task_authority_contracts where task_id = '${taskId}';
      delete from public.plan_nodes where plan_id in (select id from public.plans where task_id = '${taskId}');
      delete from public.plans where task_id = '${taskId}';
      delete from public.tasks where id = '${taskId}';
    `
      : "";
    const agentCleanup = agentId
      ? `
      delete from public.agent_auth_events where agent_id = '${agentId}';
      delete from public.agent_credentials where agent_id = '${agentId}';
      delete from public.agents where id = '${agentId}';
    `
      : "";
    await managementQuery(`
      set local role postgres;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.connector_execution_receipts where connection_id in
        (select id from public.connector_connections where name = '${connectionName}');
      delete from public.connector_reservations where connection_id in
        (select id from public.connector_connections where name = '${connectionName}');
      delete from public.task_connector_bindings where connector_id in
        (select connector_id from public.connector_connections where name = '${connectionName}');
      delete from public.custom_operation_definitions where connection_id in
        (select id from public.connector_connections where name = '${connectionName}');
      delete from public.connector_connection_secrets where connection_id in
        (select id from public.connector_connections where name = '${connectionName}');
      delete from public.connector_connections where name = '${connectionName}';
      ${taskCleanup}
      ${agentCleanup}
    `);
  });

  test("connect, configure, define and publish an operation, then run a task through it", async ({
    page,
    request,
    browser,
  }, testInfo) => {
    // The longest single real-browser workflow in this suite (connection,
    // auth, two operation lifecycle transitions, a task, a contract, an
    // approval decided by a second signed-in person, activation, two real
    // runtime calls) -- generous even accounting for real server-action
    // round trips under load, not a mask for a logic bug.
    test.setTimeout(90_000);

    // ---- 1-5: connect, configure authentication, define, validate, publish ----
    await page.goto("/app/integrations/custom-api");
    await page.getByTestId("custom-api-name").fill(connectionName);
    await page.getByTestId("custom-api-base-url").fill(FIXTURE_BASE_URL);
    await page.getByTestId("custom-api-connect").click();

    const card = page.locator('[data-testid^="custom-api-connection-custom_"]', { hasText: connectionName });
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.getByTestId("custom-api-secret-value").fill("e2e-fixture-bearer-token");
    await card.getByTestId("custom-api-save-secret").click();
    await expect(card.getByText("Credential saved.")).toBeVisible({ timeout: 15_000 });

    await card.locator('input[placeholder="get_order"]').fill("get_order");
    await card.locator('input[placeholder="Get order"]').fill("Get order");
    await card.getByTestId("custom-api-create-operation").click();
    await expect(card.getByTestId("custom-api-op-get_order")).toContainText("draft", { timeout: 15_000 });

    await card.getByTestId("custom-api-op-get_order").getByRole("button", { name: "Validate" }).click();
    await expect(card.getByTestId("custom-api-op-get_order")).toContainText("validated", { timeout: 15_000 });

    await card.getByTestId("custom-api-publish-get_order").click();
    await expect(card.getByTestId("custom-api-op-get_order")).toContainText("published", { timeout: 15_000 });

    // This <p> renders "{connectorId} · {baseUrl}" together
    // (CustomApiControls.tsx) -- the bare id is only the part before the
    // separator, not its whole text content.
    const headerText = (await card.locator("p.font-mono-code").first().textContent())?.trim() ?? "";
    const toolName = headerText.split(" · ")[0];
    expect(toolName).toMatch(/^custom_[0-9a-f]+$/);
    const fullToolName = `${toolName}.get_order`;

    // ---- 6: create task ----
    await page.goto("/app/tasks/new");
    await page.locator("#agentId").selectOption(agentId);
    await page.locator("#principalId").selectOption(principalId);
    await page.locator("#objective").fill("Look up order 4821 in Widget Orders and report its status.");
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page).toHaveURL(/\/app\/tasks\/[0-9a-f-]+$/);
    taskId = page.url().split("/").pop()!;

    // ---- 7-8: select operation, compile scope ----
    await page.goto(`/app/tasks/${taskId}/contract/new`);
    const toolRow = page.getByTestId(`available-tool-${fullToolName}`);
    await expect(toolRow).toBeVisible({ timeout: 15_000 });
    // Start from an empty plan (the default textarea content is the GitHub
    // #991 walkthrough example) so the inserted node is the plan's only one.
    const planTextarea = page.locator("#candidate-plan-json");
    await planTextarea.fill(JSON.stringify({ schemaVersion: 1, taskId, nodes: [] }));
    await page.getByTestId(`insert-tool-${fullToolName}`).click();
    // "Insert into plan" scaffolds a node with placeholder argument values
    // (empty string for a string field) -- a real author fills in the
    // concrete value the plan actually commits to next, same as this
    // suite's own GitHub example plans already hardcode a concrete
    // issue_number rather than leaving it blank. The compiled contract pins
    // an `equals` constraint to exactly this value (contract-compiler.ts's
    // buildAllowedActions), which is what later makes the resource
    // substitution below a genuine denial, not a coincidence.
    // maxInvocations also needs to be 2, not the inserted default of 1: the
    // compiled contract's per-tool budget (contract-compiler.ts sums every
    // node's maxInvocations into one total for the tool) is what actually
    // bounds how many capabilities can ever be minted for it under this
    // contract -- one for the allowed demonstration below, a second,
    // separate one for the denied resource-substitution demonstration
    // (reusing the first, already-consumed, single-use capability would
    // fail as CAPABILITY_ALREADY_USED, not the SCOPE_MISMATCH under test).
    const withRealOrderId = JSON.parse(await planTextarea.inputValue()) as {
      nodes: Array<{ arguments: Record<string, unknown>; maxInvocations: number }>;
    };
    withRealOrderId.nodes[0].arguments.orderId = "4821";
    withRealOrderId.nodes[0].maxInvocations = 2;
    await planTextarea.fill(JSON.stringify(withRealOrderId));
    await page.getByRole("button", { name: "Validate" }).click();
    await expect(page.locator("#plan-findings")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Propose contract" }).click();
    await expect(page.locator("#contract-proposal")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "View the task and its proposed contract" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/tasks/${taskId}$`));

    // ---- 9: activate (handling the required-approval flow, since every
    // Custom API operation is conservatively marked confidential/external,
    // which always triggers at least one required approval) ----
    await activateWithApprovalIfNeeded(page, browser, testInfo, taskId);
    await expect(page.getByText("Active", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "test-results/custom-api-contract-active.png", fullPage: true });

    // ---- issue a runtime credential ----
    await page.goto(`/app/agents/${agentId}`);
    await page.getByRole("button", { name: "Issue credential" }).click();
    const secretLocator = page.getByText(/^authority_rk_/);
    await expect(secretLocator).toBeVisible({ timeout: 15_000 });
    const secret = (await secretLocator.textContent())?.trim() ?? "";
    expect(secret).toMatch(/^authority_rk_[0-9a-f]+$/);

    await resetFixture(request);

    // ---- 10-11: authorize + execute (the allowed call) ----
    const authorize = await request.post("/api/v1/authorize", {
      headers: { authorization: `Bearer ${secret}` },
      data: {
        taskId,
        tool: fullToolName,
        operation: "get_order",
        resource: "4821",
        arguments: { orderId: "4821" },
        idempotencyKey: `e2e-allow-${RUN}`,
      },
    });
    expect(authorize.status()).toBe(200);
    const authorizeBody = await authorize.json();
    expect(authorizeBody.capability.token).toMatch(/^authcap_v1_/);
    const capability = authorizeBody.capability.token as string;

    const execute = await request.post("/api/v1/execute", {
      headers: { authorization: `Bearer ${secret}` },
      data: {
        capability,
        tool: fullToolName,
        operation: "get_order",
        resource: "4821",
        arguments: { orderId: "4821" },
        idempotencyKey: `e2e-exec-allow-${RUN}`,
      },
    });
    expect(execute.status()).toBe(200);
    const executeBody = await execute.json();
    expect(executeBody.data).toMatchObject({ id: "4821", status: "pending" });

    const afterAllowed = await readFixtureLog(request);
    expect(afterAllowed.count).toBe(1);
    expect(afterAllowed.paths).toEqual(["/v1/orders/4821"]);

    // ---- 12: inspect the receipt, through the UI ----
    await page.goto("/app/runtime");
    await expect(page.locator("tbody").getByText(fullToolName).first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "test-results/custom-api-runtime-receipt.png", fullPage: true });

    // ---- the denied call: resource/argument substitution at execute time.
    // The contract pins orderId to exactly "4821" (contract-compiler.ts's
    // buildAllowedActions turns every concrete plan argument into an
    // `equals` constraint), so authorize only ever mints a capability
    // reserved for that exact value -- a second, FRESH authorize call with
    // the same valid arguments and a new idempotency key (the capability
    // above was already consumed, single-use, by the allowed execute).
    // Presenting THIS capability at execute time with a substituted
    // resource/argument must be refused before any request reaches the
    // fixture. ----
    const secondAuthorize = await request.post("/api/v1/authorize", {
      headers: { authorization: `Bearer ${secret}` },
      data: {
        taskId,
        tool: fullToolName,
        operation: "get_order",
        resource: "4821",
        arguments: { orderId: "4821" },
        idempotencyKey: `e2e-allow-2-${RUN}`,
      },
    });
    expect(secondAuthorize.status()).toBe(200);
    const secondCapability = (await secondAuthorize.json()).capability.token as string;

    const deniedExecute = await request.post("/api/v1/execute", {
      headers: { authorization: `Bearer ${secret}` },
      data: {
        capability: secondCapability,
        tool: fullToolName,
        operation: "get_order",
        resource: "9999",
        arguments: { orderId: "9999" },
        idempotencyKey: `e2e-exec-deny-${RUN}`,
      },
    });
    expect(deniedExecute.status()).toBe(403);
    const deniedBody = await deniedExecute.json();
    expect(deniedBody.error.code).toBe("SCOPE_MISMATCH");

    const afterDenied = await readFixtureLog(request);
    expect(afterDenied.count).toBe(1); // unchanged -- the denied call never reached the fixture
  });
});

/**
 * Submits for approval and decides every pending slot as a second person
 * (ADMIN_A, in a fresh browser context with no shared session -- mirroring
 * github-connector.spec.ts's own "a runtime approval is decided by a second
 * person" pattern), then activates as the original signed-in owner.
 *
 * Every Custom API operation is marked `dataSensitivity: "confidential"` and
 * `externalCommunication: true` (src/lib/registry/tenant.ts), which
 * unconditionally derives exactly one merged `security_admin+ x1` approval
 * requirement regardless of the operation's effect (approval-rules.ts rules
 * 3 and 5) -- never a `task_owner` slot for a read effect. `self_approval_
 * allowed` is false for a role-derived slot, so the submitter (owner.a, the
 * default signed-in session) cannot decide it themselves; a second,
 * non-submitting admin+ principal (ADMIN_A) must.
 *
 * `#contract-approvals`'s rows only exist after submission and the panel
 * only fetches them on mount, so a reload is required after submitting
 * before the rows are visible (confirmed against ContractApprovalPanel.tsx's
 * own effect dependencies).
 */
async function activateWithApprovalIfNeeded(
  page: Page,
  browser: Browser,
  testInfo: TestInfo,
  taskId: string,
): Promise<void> {
  const submitButton = page.getByRole("button", { name: "Submit for approval" });
  if (await submitButton.isVisible().catch(() => false)) {
    await submitButton.click();
    await expect(page.getByText("Awaiting approval — not active", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();

    const approvals = page.locator("#contract-approvals");
    await expect(approvals).toBeVisible({ timeout: 15_000 });

    const ctx = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const adminPage = await ctx.newPage();
    await signIn(adminPage, ADMIN_A);
    await adminPage.goto(`/app/tasks/${taskId}`);
    const adminApprovals = adminPage.locator("#contract-approvals");
    await expect(adminApprovals).toBeVisible({ timeout: 15_000 });
    // At least one slot must be pending and decidable here -- fail loudly
    // and specifically if not, rather than silently skipping the loop below
    // and surfacing a confusing failure much later at Activate.
    await expect(adminApprovals.getByRole("button", { name: "Approve" }).first()).toBeVisible({
      timeout: 15_000,
    });

    let approveButton = adminApprovals.getByRole("button", { name: "Approve" }).first();
    while (await approveButton.isVisible().catch(() => false)) {
      await approveButton.click();
      await expect(adminApprovals.getByText("approved", { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
      approveButton = adminApprovals.getByRole("button", { name: "Approve" }).first();
    }
    await ctx.close();
    await page.reload();
  }
  await page.getByRole("button", { name: "Activate" }).click();
}
