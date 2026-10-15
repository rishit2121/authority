import { randomBytes, randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { managementQuery } from "../integration/support";

/**
 * The guided Setup page, end to end, for a brand-new account: the real
 * /login form, the real /app/setup page, and then the keys it hands out used
 * against the real developer API -- proving the one-click setup actually
 * produces a working integration, not just a page that renders.
 *
 * The user is created pre-confirmed exactly like supabase/seed.sql and the
 * fresh-signup test in auth-flows.spec.ts do (there is no inbox to click
 * through here). The Slack connection is inserted directly, like
 * copy-buttons.spec.ts does: connecting Slack through its own page would
 * call Slack's real API to verify the token. Nothing in this test ever
 * executes a Slack call -- it stops at authorize, which never contacts the
 * provider.
 */

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

async function api(
  request: APIRequestContext,
  method: "GET" | "POST",
  path: string,
  token: string,
  body?: unknown,
) {
  const response = await request.fetch(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status(), json };
}

test("a brand-new account goes from signup to a working, least-privilege agent on one page", async ({
  page,
  request,
}) => {
  const suffix = `${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
  const email = `setup-flow-${suffix}@authority.test`;
  const password = "Setup-Flow-Test-2026!";

  const users = (await managementQuery(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      is_sso_user, is_anonymous,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      '${email}', extensions.crypt('${password}', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('display_name', 'Setup Flow ${suffix}'),
      false, false, '', '', '', '', '', '', '', ''
    ) returning id;
  `)) as Array<{ id: string }>;
  const userId = users[0]?.id;
  expect(userId).toBeTruthy();
  const connectionId = randomUUID();

  try {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

    // A fresh workspace gets one clear next step.
    await expect(page.getByRole("heading", { name: "Set up Authority in 3 steps" })).toBeVisible();
    await page.getByRole("link", { name: "Start setup" }).click();
    await expect(page).toHaveURL(/\/app\/setup$/);
    await expect(page.getByTestId("setup-step-1")).toHaveAttribute("data-done", "false");

    const tenants = (await managementQuery(
      `select tenant_id from public.tenant_memberships where user_id = '${userId}' limit 1;`,
    )) as Array<{ tenant_id: string }>;
    const tenantId = tenants[0]?.tenant_id;
    expect(tenantId).toBeTruthy();
    await managementQuery(`
      insert into public.connector_connections (id, tenant_id, connector_id, name, owner_kind, status)
      values ('${connectionId}', '${tenantId}', 'slack', 'Team Slack', 'organization', 'active');
    `);

    await page.reload();
    await expect(page.getByTestId("setup-step-1")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId(`setup-connection-${connectionId}`)).toBeChecked();

    await page.getByTestId("setup-agent-name").fill(`Setup agent ${suffix}`);
    await page.getByTestId("setup-submit").click();
    const envBlock = page.getByTestId("setup-env");
    await expect(envBlock).toBeVisible({ timeout: 20_000 });
    const env = parseEnv((await envBlock.locator("code").textContent()) ?? "");
    expect(env.AUTHORITY_URL).toMatch(/^http/);
    expect(env.AUTHORITY_BACKEND_API_KEY).toMatch(/^authority_dk_/);
    expect(env.AUTHORITY_AGENT_RUNTIME_KEY).toBeTruthy();
    expect(env.AUTHORITY_AGENT_ID).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.getByTestId("setup-step-2")).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("setup-waiting")).toBeVisible();

    const backendKey = env.AUTHORITY_BACKEND_API_KEY;
    const runtimeKey = env.AUTHORITY_AGENT_RUNTIME_KEY;

    // The shared connection is usable by any customer of this app, with no per-customer grant.
    const customer = await api(request, "POST", "/api/v1/customers", backendKey, {
      externalId: `setup-flow-user-${suffix}`,
    });
    expect([200, 201]).toContain(customer.status);
    const customerId = customer.json.customerId as string;
    const listed = await api(request, "GET", `/api/v1/customers/${customerId}/connections`, backendKey);
    expect(listed.status).toBe(200);
    const connections = listed.json.connections as Array<{ connectionId: string; connectorId: string }>;
    expect(connections.map((c) => c.connectionId)).toContain(connectionId);

    async function prepare(tool: string, resourceBinding: string, expectedSideEffect: string) {
      const task = await api(request, "POST", `/api/v1/customers/${customerId}/tasks`, backendKey, {
        agentId: env.AUTHORITY_AGENT_ID,
        intent: `setup-flow ${tool}`,
        connections: [{ connectorId: "slack", connectionId }],
      });
      expect([200, 201]).toContain(task.status);
      const taskId = task.json.taskId as string;
      const prepared = await api(request, "POST", `/api/v1/tasks/${taskId}/prepare`, backendKey, {
        plan: {
          schemaVersion: 1,
          taskId,
          nodes: [
            {
              id: "n1",
              sequence: 1,
              tool,
              arguments: tool === "slack.post_message" ? { channel: "C123", text: "hi" } : {},
              resourceBinding,
              expectedSideEffect,
            },
          ],
        },
      });
      expect(prepared.status).toBe(200);
      return { taskId, status: prepared.json.status as string };
    }

    // With no approval rules, nothing waits for a person -- a read or a write.
    const read = await prepare("slack.list_channels", "workspace", "read");
    expect(read.status).toBe("ready");
    const write = await prepare("slack.post_message", "C123", "write_create");
    expect(write.status).toBe("ready");

    // The agent sees exactly the one granted tool.
    const manifest = await api(request, "GET", `/api/v1/tasks/${read.taskId}/tools`, runtimeKey);
    expect(manifest.status).toBe(200);
    expect((manifest.json.tools as Array<{ tool: string }>).map((t) => t.tool)).toEqual([
      "slack.list_channels",
    ]);

    const decision = await api(request, "POST", "/api/v1/authorize", runtimeKey, {
      taskId: read.taskId,
      tool: "slack.list_channels",
      operation: "list_channels",
      resource: "workspace",
      arguments: {},
      idempotencyKey: `setup-flow-${suffix}`,
    });
    expect(decision.status).toBe(200);
    expect((decision.json.capability as { token?: string } | null)?.token).toBeTruthy();

    // The page notices the first call on its own.
    await expect(page.getByTestId("setup-first-call")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("setup-step-3")).toHaveAttribute("data-done", "true");

    // An admin adds an approval rule; the same kind of task now waits on the Approvals page.
    await page.goto("/app/approvals");
    const rules = page.getByTestId("approval-rules-list");
    await expect(rules).toContainText("No rules");
    await page.getByTestId("rule-key").selectOption("tool");
    await page.getByTestId("rule-matches").selectOption("slack.post_message");
    await page.getByTestId("rule-add").click();
    await expect(rules).toContainText("slack.post_message");
    const held = await prepare("slack.post_message", "C123", "write_create");
    expect(held.status).toBe("awaiting_approval");
    expect((await prepare("slack.list_channels", "workspace", "read")).status).toBe("ready");
    await page.reload();
    await expect(page.getByTestId("approvals-list")).toContainText("setup-flow slack.post_message");

    // Removing the rule puts it back: writes start right away again.
    await rules.getByRole("button", { name: "Remove" }).click();
    await expect(rules).toContainText("No rules");
    expect((await prepare("slack.post_message", "C123", "write_create")).status).toBe("ready");
  } finally {
    // Same rationale as auth-flows.spec.ts's fresh-signup test: the tenant
    // itself can never be deleted (authz.enforce_owner_survives), so only
    // revoke what could be used -- every key this test minted -- and drop
    // the fake connection.
    await managementQuery(`
      set local role postgres;
      select set_config('authority.allow_demo_purge', 'on', true);
      update public.agent_credentials set status = 'revoked', revoked_at = now(), revocation_reason = 'setup-flow e2e cleanup'
        where status = 'active' and agent_id in (
          select a.id from public.agents a join public.principals p on p.id = a.owner_principal_id
          where p.user_id = '${userId}');
      update public.developer_backend_credentials set status = 'revoked', revoked_at = now(), revocation_reason = 'setup-flow e2e cleanup'
        where status = 'active' and application_id in (
          select ap.id from public.applications ap join public.tenant_memberships m on m.tenant_id = ap.tenant_id
          where m.user_id = '${userId}');
      update public.connector_connections set status = 'disconnected', disconnected_at = now() where id = '${connectionId}';
    `);
  }
});
