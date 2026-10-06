import { createHmac } from "node:crypto";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { createGatewayFixture, purgeGithubState, type GatewayFixture } from "../integration/gateway-support";
import { managementQuery } from "../integration/support";
import { signIn } from "./support/auth";
import { ADMIN_A } from "./support/users";

/**
 * The first real Authority-controlled agent workflow, end to end, against the MOCK GitHub
 * (GITHUB_EXECUTION_MODE=mock in the app server — see playwright.config.ts): connect the App
 * through the real installation flow, allow a repository, bind a task, run an agent through
 * authorize -> reserve -> execute -> receipt over real HTTP, resolve a runtime approval as a
 * second person, and inspect failure / indeterminate / drift / disconnect states in the UI.
 * No real GitHub credential is involved anywhere.
 */

const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_USER = "a0000000-0000-4000-8000-000000000001";
const ADMIN_USER = "a0000000-0000-4000-8000-000000000002";
const P_OWNER = "ee2e0000-0000-4000-8000-0000000000a1";
const P_ADMIN = "ee2e0000-0000-4000-8000-0000000000a2";
const WEBHOOK_SECRET = "mock-webhook-secret";
const RUN = Date.now().toString(36);

const ACTIONS = JSON.stringify({
  schemaVersion: 1,
  items: [
    "github.get_issue",
    "github.read_repository",
    "github.create_branch",
    "github.put_file",
    "github.create_pull_request",
  ].map((tool) => ({ tool, constraints: [] })),
});

const branchFor = (fx: GatewayFixture, slug: string) =>
  `authority/${fx.taskId.replace(/-/g, "").slice(0, 8)}/${slug}-${RUN}`;

async function authorize(
  request: APIRequestContext,
  fx: GatewayFixture,
  tool: string,
  args: Record<string, string>,
  key: string,
  resource = "acme/widgets",
) {
  const res = await request.post("/api/v1/authorize", {
    headers: { authorization: `Bearer ${fx.secret}` },
    data: {
      taskId: fx.taskId,
      tool,
      operation: tool.split(".")[1],
      resource,
      arguments: args,
      idempotencyKey: key,
    },
  });
  expect(res.status()).toBe(200);
  return res.json();
}

async function execute(
  request: APIRequestContext,
  fx: GatewayFixture,
  capability: string,
  tool: string,
  args: Record<string, string>,
  key: string,
  resource = "acme/widgets",
) {
  const res = await request.post("/api/v1/github/execute", {
    headers: { authorization: `Bearer ${fx.secret}` },
    data: { capability, tool, operation: tool.split(".")[1], resource, arguments: args, idempotencyKey: key },
  });
  return { status: res.status(), body: await res.json() };
}

async function run(
  request: APIRequestContext,
  fx: GatewayFixture,
  tool: string,
  args: Record<string, string>,
  key: string,
  resource = "acme/widgets",
) {
  const auth = await authorize(request, fx, tool, args, `auth-${key}`, resource);
  expect(auth.capability?.token, JSON.stringify(auth.reasonCodes)).toMatch(/^authcap_v1_/);
  return execute(request, fx, auth.capability.token, tool, args, `exec-${key}`, resource);
}

async function hasNoHorizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
}

test.describe.serial("GitHub connector (mock GitHub)", () => {
  let fx: GatewayFixture;
  let fault: GatewayFixture;

  test.beforeAll(async () => {
    await purgeGithubState();
    await managementQuery(`
      insert into public.principals (id, tenant_id, kind, display_name, user_id) values
        ('${P_OWNER}', '${TENANT_A_ID}', 'human', 'E2E Owner Principal', '${OWNER_USER}'),
        ('${P_ADMIN}', '${TENANT_A_ID}', 'human', 'E2E Admin Principal', '${ADMIN_USER}')
      on conflict (id) do nothing;
      insert into public.semantic_settings (tenant_id, runtime_approval_classes) values ('${TENANT_A_ID}', '{}')
        on conflict (tenant_id) do update set runtime_approval_classes = '{}';
    `);
    // "tenant", not `true` on both: this suite calls the real
    // /api/v1/authorize route, which authorizes through
    // buildTenantRegistry(tenantId) internally, not the bare fixture file --
    // the contract must match.
    fx = await createGatewayFixture({
      label: "e2e-gh",
      actions: ACTIONS,
      maxToolInvocations: 100,
      useCurrentVersions: "tenant",
    });
    fault = await createGatewayFixture({
      label: "e2e-gh-fault",
      actions: ACTIONS,
      maxToolInvocations: 100,
      useCurrentVersions: "tenant",
    });
    // The task belongs to the signed-in owner, so the owner cannot approve its own runtime requests.
    await managementQuery(`update public.tasks set principal_id = '${P_OWNER}' where id = '${fx.taskId}';`);
  });

  test.afterAll(async () => {
    await fx?.cleanup();
    await fault?.cleanup();
    await purgeGithubState();
    await managementQuery(`
      update public.semantic_settings set runtime_approval_classes = '{}' where tenant_id = '${TENANT_A_ID}';
      set local role postgres;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.principals p where p.id in ('${P_OWNER}', '${P_ADMIN}')
        and not exists (select 1 from public.tasks t where t.principal_id = p.id)
        and not exists (select 1 from public.agents a where a.owner_principal_id = p.id)
        and not exists (select 1 from public.runtime_approval_decisions d where d.approver_principal_id = p.id);
    `).catch(() => undefined);
  });

  test("connects through the state-bound installation flow and shows the least-privilege permissions", async ({
    page,
  }) => {
    await page.goto("/app/integrations/github");
    await expect(page.getByTestId("github-not-connected")).toBeVisible();
    await expect(page.getByTestId("mode-badge-mock").first()).toBeVisible();
    for (const p of ["contents: write", "issues: read", "metadata: read", "pull_requests: write"]) {
      await expect(page.getByTestId("expected-permissions").getByText(p)).toBeVisible();
    }

    // A crafted callback with no state cookie from this browser is refused and connects nothing.
    await page.goto("/api/github/setup?installation_id=9001&state=" + "a".repeat(43));
    await expect(page.getByTestId("github-error")).toContainText(
      /without the connection having been started from Authority/i,
    );
    await expect(page.getByTestId("github-not-connected")).toBeVisible();

    await page.getByTestId("github-connect").click();
    await expect(page.getByTestId("github-connected")).toBeVisible();
    const inst = page.getByTestId("github-installation");
    await expect(inst).toContainText("acme");
    await expect(page.getByTestId("installation-status")).toHaveText("active");
    await expect(inst.getByTestId("mode-badge-mock")).toBeVisible();

    // Discovery is restricted to the installation and nothing is allowed by default.
    await expect(page.getByTestId("repo-acme/widgets")).toBeVisible();
    await expect(page.getByTestId("repo-globex/secret")).toHaveCount(0);
    await expect(page.getByTestId("repo-state-acme/widgets")).toHaveText("not allowed");
  });

  test("allows a repository and binds a task to it; the contract view shows the exact GitHub operations", async ({
    page,
  }) => {
    await page.goto("/app/integrations/github");
    await page.getByTestId("repo-toggle-acme/widgets").click();
    await expect(page.getByTestId("repo-state-acme/widgets")).toHaveText("allowed");
    await page.getByTestId("repo-toggle-acme/fault-write-timeout").click();
    await expect(page.getByTestId("repo-state-acme/fault-write-timeout")).toHaveText("allowed");

    await page.goto(`/app/tasks/${fx.taskId}`);
    const panel = page.getByTestId("github-task-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("mode-badge-mock").first()).toBeVisible();
    await expect(page.getByTestId("no-executions")).toBeVisible();
    await page.getByTestId("bind-repo-select").selectOption({ label: "acme/widgets" });
    await page.getByTestId("bind-repo-submit").click();
    await expect(page.getByTestId("bound-repository")).toContainText("acme/widgets");
    await expect(page.getByTestId("bound-repository")).toContainText("never writable");
    const ops = page.getByTestId("contract-github-actions");
    for (const tool of [
      "github.get_issue",
      "github.create_branch",
      "github.put_file",
      "github.create_pull_request",
    ]) {
      await expect(ops).toContainText(tool);
    }
    await expect(ops).toContainText("acme/widgets");

    await page.goto(`/app/tasks/${fault.taskId}`);
    await page.getByTestId("bind-repo-select").selectOption({ label: "acme/fault-write-timeout" });
    await page.getByTestId("bind-repo-submit").click();
    await expect(page.getByTestId("bound-repository")).toContainText("acme/fault-write-timeout");
  });

  test("an agent runs authorize -> execute -> receipt; the UI shows execution, receipt, PR link and a graph driven by persisted events", async ({
    page,
    request,
  }) => {
    const branch = branchFor(fx, "fix");
    const issue = await run(request, fx, "github.get_issue", { issue_number: "1" }, "issue");
    expect(issue.status).toBe(200);
    expect(issue.body).toMatchObject({ result: "succeeded", execution: { mode: "mock", simulated: true } });
    expect(issue.body.data.title).toBe("Fix login bug");

    expect((await run(request, fx, "github.create_branch", { branch }, "branch")).body.result).toBe(
      "succeeded",
    );
    expect((await run(request, fx, "github.create_branch", { branch }, "branch2")).body.result).toBe(
      "succeeded_noop",
    );
    expect(
      (
        await run(
          request,
          fx,
          "github.put_file",
          { branch, path: "fix/login.txt", content: "fixed\n", message: "Fix login" },
          "file",
        )
      ).body.result,
    ).toBe("succeeded");
    const pr = await run(
      request,
      fx,
      "github.create_pull_request",
      { head: branch, base: "main", title: "Fix login", body: "Fixes #1" },
      "pr",
    );
    expect(pr.body.result).toBe("succeeded");
    expect(pr.body.resource.htmlUrl).toMatch(/^https:\/\/github\.com\/acme\/widgets\/pull\/\d+$/);

    // Guardrails over real HTTP: default branch, traversal and a smuggled URL never reach GitHub.
    const main = await run(request, fx, "github.create_branch", { branch: "main" }, "main-branch");
    expect(main.status).toBe(422);
    expect(main.body.error.code).toBe("BRANCH_OUTSIDE_TASK_NAMESPACE");
    const trav = await run(
      request,
      fx,
      "github.put_file",
      { branch, path: "../x", content: "x", message: "m" },
      "trav",
    );
    expect(trav.body.error.code).toBe("PATH_TRAVERSAL");
    const url = await run(
      request,
      fx,
      "github.get_issue",
      { issue_number: "1", url: "https://evil.example/x" },
      "url",
    );
    expect(url.body.error.code).toBe("ARGUMENTS_INVALID");

    // A missing / garbage credential and the old simulated endpoint.
    const noAuth = await request.post("/api/v1/github/execute", { data: {} });
    expect(noAuth.status()).toBe(401);
    const auth = await authorize(request, fx, "github.get_issue", { issue_number: "1" }, "sim-1");
    const sim = await request.post("/api/v1/capabilities/consume", {
      headers: { authorization: `Bearer ${fx.secret}` },
      data: {
        capability: auth.capability.token,
        tool: "github.get_issue",
        operation: "get_issue",
        resource: "acme/widgets",
        arguments: { issue_number: "1" },
        idempotencyKey: "sim-consume",
      },
    });
    expect((await sim.json()).error.code).toBe("CONNECTOR_EXECUTION_REQUIRED");

    await page.goto(`/app/tasks/${fx.taskId}`);
    const list = page.getByTestId("execution-list");
    await expect(list.getByTestId("execution-consumed").first()).toBeVisible();
    await expect(list.getByTestId("receipt").first()).toBeVisible();
    await expect(list.getByTestId("mode-badge-mock").first()).toContainText("MOCK");
    const link = page.getByTestId("pr-link");
    await expect(link).toHaveAttribute("href", /^https:\/\/github\.com\/acme\/widgets\/pull\/\d+$/);

    // The graph is a replay of persisted execution events.
    const flow = page.getByTestId("execution-flow");
    await expect(flow).toBeVisible();
    const total = Number(await flow.getAttribute("data-step-count"));
    expect(total).toBeGreaterThanOrEqual(8);
    await expect(flow.getByTestId("flow-step-reserved").first()).toBeVisible();
    await expect(flow.getByTestId("flow-step-dispatched").first()).toBeVisible();
    await expect(flow.getByTestId("flow-step-succeeded").first()).toBeVisible();
    await expect(flow).toHaveAttribute("data-step-index", String(total - 1));
    await page.getByTestId("flow-replay").click();
    await expect(flow).toHaveAttribute("data-step-index", "0");
    await expect(flow).toHaveAttribute("data-step-index", String(total - 1), { timeout: 15_000 });

    // The full timeline records the same events.
    await expect(page.locator("#timeline")).toContainText("MOCK GitHub github.create_pull_request");
  });

  test("a runtime approval is decided by a second person, then the agent's re-request mints the capability", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(90_000);
    await managementQuery(
      `update public.semantic_settings set runtime_approval_classes = '{medium}' where tenant_id = '${TENANT_A_ID}';`,
    );
    const branch = branchFor(fx, "approved");
    const args = { branch };
    const held = await authorize(request, fx, "github.create_branch", args, "approval-1");
    expect(held.status).toBe("require_approval");
    expect(held.capability).toBeNull();
    expect(held.approval).toMatchObject({ state: "pending", requiredApprovals: 1 });
    expect(JSON.stringify(held)).not.toMatch(/semantic|provider|POLICY_REQUIRES/i);

    const status = await request.get(held.approval.statusUrl, {
      headers: { authorization: `Bearer ${fx.secret}` },
    });
    expect((await status.json()).state).toBe("pending");
    // Another agent's key cannot read it.
    const other = await request.get(held.approval.statusUrl, {
      headers: { authorization: `Bearer ${fault.secret}` },
    });
    expect(other.status()).toBe(404);

    // The signed-in owner owns the task, so the database refuses their decision.
    await page.goto("/app/approvals");
    const card = page.getByTestId("runtime-approval-pending").first();
    await expect(card).toContainText("github.create_branch");
    await card.getByTestId(new RegExp("^approve-")).click();
    await expect(page.getByTestId("approval-result").first()).toContainText(/cannot decide/i);

    // A different person (admin) approves in their own session.
    const ctx = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const adminPage = await ctx.newPage();
    await signIn(adminPage, ADMIN_A);
    await adminPage.goto("/app/approvals");
    const adminCard = adminPage.getByTestId("runtime-approval-pending").first();
    await adminCard.getByTestId(new RegExp("^approve-")).click();
    await expect(adminPage.getByTestId("runtime-approval-approved").first()).toBeVisible({ timeout: 15_000 });
    await ctx.close();

    // Approval alone minted nothing; the agent re-requests with the same key and arguments.
    const noCap = await request.get(held.approval.statusUrl, {
      headers: { authorization: `Bearer ${fx.secret}` },
    });
    expect((await noCap.json()).state).toBe("approved");
    const minted = await authorize(request, fx, "github.create_branch", args, "approval-1");
    expect(minted.status).toBe("allow");
    expect(minted.reasonCodes).toContain("APPROVAL_GRANTED");
    expect(minted.capability.token).toMatch(/^authcap_v1_/);
    const done = await execute(
      request,
      fx,
      minted.capability.token,
      "github.create_branch",
      args,
      "approval-exec",
    );
    expect(done.body.result).toBe("succeeded");
    const again = await authorize(request, fx, "github.create_branch", args, "approval-1");
    expect(again.capability.token).toBeNull();

    await page.goto(`/app/tasks/${fx.taskId}`);
    await expect(page.getByTestId("task-approvals")).toContainText("consumed");
    await expect(page.getByTestId("flow-step-approval_requested")).toBeVisible();
    await expect(page.getByTestId("flow-step-approval_granted")).toBeVisible();
    await managementQuery(
      `update public.semantic_settings set runtime_approval_classes = '{}' where tenant_id = '${TENANT_A_ID}';`,
    );
  });

  test("shows an indeterminate write, never retries it, and lets an operator record what they found", async ({
    page,
    request,
  }) => {
    const branch = branchFor(fault, "lost");
    const r = await run(
      request,
      fault,
      "github.create_branch",
      { branch },
      "lost",
      "acme/fault-write-timeout",
    );
    expect(r.status).toBe(504);
    expect(r.body).toMatchObject({ status: "indeterminate", error: { code: "EXECUTION_INDETERMINATE" } });

    await page.goto(`/app/tasks/${fault.taskId}`);
    const item = page.getByTestId("execution-indeterminate");
    await expect(item).toBeVisible();
    await expect(item.getByTestId("execution-explain")).toContainText(/NOT retried/i);
    await expect(page.getByTestId("flow-step-indeterminate")).toBeVisible();
    await item.getByRole("textbox").fill("Branch exists on GitHub");
    await item.getByRole("button", { name: "It was executed" }).click();
    await expect(page.getByTestId("resolution")).toContainText(/executed/i);
    await expect(page.getByTestId("resolution")).toContainText(/stays spent/i);
  });

  test("permission drift disables execution until the installation is re-verified; disconnect revokes everything", async ({
    page,
    request,
  }) => {
    // GitHub says the App accepted new permissions: never trusted until re-verified.
    const body = JSON.stringify({ action: "new_permissions_accepted", installation: { id: 9001 } });
    const sig = `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;
    const bad = await request.post("/api/github/webhook", {
      headers: {
        "x-github-event": "installation",
        "x-github-delivery": crypto.randomUUID(),
        "x-hub-signature-256": "sha256=" + "0".repeat(64),
        "content-type": "application/json",
      },
      data: body,
    });
    expect(bad.status()).toBe(401);
    const ok = await request.post("/api/github/webhook", {
      headers: {
        "x-github-event": "installation",
        "x-github-delivery": crypto.randomUUID(),
        "x-hub-signature-256": sig,
        "content-type": "application/json",
      },
      data: body,
    });
    expect(ok.status()).toBe(200);

    await page.goto("/app/integrations/github");
    await expect(page.getByTestId("installation-status")).toHaveText("permission drift");
    await expect(page.getByTestId("installation-health-reasons")).toContainText("NEEDS_REVERIFICATION");
    const blocked = await run(request, fx, "github.get_issue", { issue_number: "1" }, "drift");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("INSTALLATION_UNAVAILABLE");

    await page.getByTestId("github-refresh").click();
    await expect(page.getByTestId("installation-status")).toHaveText("active", { timeout: 15_000 });
    const again = await run(request, fx, "github.get_issue", { issue_number: "1" }, "recovered");
    expect(again.body.result).toBe("succeeded");

    // GitHub's "redirect on update" for an already-connected installation just re-reads it.
    await page.goto("/api/github/setup?installation_id=9001&setup_action=update");
    await expect(page.getByTestId("github-updated")).toBeVisible();
    await expect(page.getByTestId("installation-status")).toHaveText("active");

    // A capability issued before disconnect stops working the moment the installation is disconnected.
    const pending = await authorize(request, fx, "github.get_issue", { issue_number: "1" }, "pre-disc");
    await page.getByTestId("github-disconnect").click();
    await page.getByTestId("github-disconnect-confirm").click();
    await expect(page.getByTestId("github-not-connected")).toBeVisible({ timeout: 15_000 });
    const after = await execute(
      request,
      fx,
      pending.capability.token,
      "github.get_issue",
      { issue_number: "1" },
      "post-disc",
    );
    expect(after.status).toBe(409);
    expect(["CAPABILITY_REVOKED", "REPOSITORY_NOT_ALLOWED", "INSTALLATION_UNAVAILABLE"]).toContain(
      after.body.error.code,
    );
  });

  test("the GitHub pages fit a phone screen without horizontal scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/app/integrations/github");
    await expect(page.getByTestId("github-not-connected")).toBeVisible();
    expect(await hasNoHorizontalOverflow(page)).toBe(true);
    await page.goto(`/app/tasks/${fx.taskId}`);
    await expect(page.getByTestId("github-task-panel")).toBeVisible();
    expect(await hasNoHorizontalOverflow(page)).toBe(true);
    await page.goto("/app/approvals");
    await expect(page.getByTestId("runtime-approvals")).toBeVisible();
    expect(await hasNoHorizontalOverflow(page)).toBe(true);
  });
});
