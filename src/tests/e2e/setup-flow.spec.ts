import { randomBytes } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { managementQuery } from "../integration/support";

/**
 * The guided Setup page, end to end, for a brand-new account: the real /login form, the real /app/setup page, the
 * real Gmail connect route and callback (GMAIL_FIXTURE_MODE: the in-process fake Google, never Google), one real
 * protected call, and then the keys it hands out used against the real developer API -- proving the guided setup
 * produces a working, least-privilege integration and shares nothing it was not told to.
 *
 * The user is created pre-confirmed exactly like supabase/seed.sql and the fresh-signup test in auth-flows.spec.ts
 * do (there is no inbox to click through here).
 */

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

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

test("a brand-new account goes from signup to one protected call, sharing with its test customer only", async ({
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

  try {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

    // No allowed protected call yet: the home page points to setup.
    await expect(page.getByRole("heading", { name: "Finish setting up Authority" })).toBeVisible();
    await page.getByRole("link", { name: "Continue setup" }).click();
    await expect(page).toHaveURL(/\/app\/setup$/);

    // No app yet: an explicit "Create your app".
    await expect(page.getByTestId("setup-app-name")).toHaveValue("My app");
    await page.getByTestId("setup-create-app-submit").click();
    await expect(page).toHaveURL(/\/app\/setup\?app=[0-9a-f-]{36}$/);
    const appId = new URL(page.url()).searchParams.get("app")!;
    await expect(page.getByTestId("setup-app-name-display")).toHaveText("My app");

    // Connect Gmail through its own page; Google's (fixture) consent returns to this step with the app kept.
    await expect(page.getByTestId("setup-card-gmail")).toContainText("Google account consent (OAuth)");
    await page.getByTestId("setup-connect-gmail").click();
    await expect(page).toHaveURL(/\/app\/integrations\/gmail\?returnTo=/);
    await page.getByTestId("gmail-name").fill("Support inbox");
    await page.getByTestId("gmail-connect").click();
    const oauthForm = page.locator('[data-testid^="gmail-connect-oauth-"]');
    await expect(oauthForm).toHaveCount(1);
    await oauthForm.getByRole("button", { name: "Connect with Google" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/setup\\?app=${appId}&connected=gmail$`));
    await expect(page.getByText("Gmail connected.")).toBeVisible();

    // Exactly one candidate: preselected, but nothing happens until the user confirms it.
    const radio = page.locator('input[name="setup-connection"]');
    await expect(radio).toHaveCount(1);
    await expect(radio).toBeChecked();
    await expect(page.getByTestId("setup-access")).toHaveCount(0);
    const connectionId = (await radio.getAttribute("value"))!;
    await expect(page.getByTestId(`setup-connection-state-${connectionId}`)).toHaveText("Needs access");
    await page.getByTestId("setup-use-connection").click();
    await expect(page).toHaveURL(new RegExp(`connection=${connectionId}`));

    // Who can use it -- shown before any change -- then the one explicit, narrow grant.
    await expect(page.getByTestId("setup-access-summary")).toHaveText("Only admins (no customers yet)");
    await page.getByTestId("setup-share-test-customer").click();
    await expect(page.getByTestId("setup-access-summary")).toHaveText("Shared with 1 specific customer");
    await expect(page.getByTestId("setup-chosen-state")).toHaveText("Ready for this customer");

    // One real protected call: gmail.list_labels, against the fixture Gmail API.
    await page.getByTestId("setup-make-call").click();
    await expect(page.getByTestId("setup-call-label")).toHaveText("Allowed", { timeout: 30_000 });
    await expect(page.getByTestId("setup-call-result")).toContainText(/\d+ labels?/);
    await expect(page.getByTestId("setup-recorded-label")).toHaveText("Allowed");
    await expect(page.getByTestId("setup-recorded-receipt")).not.toHaveText("none");
    const env = parseEnv((await page.getByTestId("setup-env").locator("code").textContent()) ?? "");
    expect(env.AUTHORITY_BACKEND_API_KEY).toMatch(/^authority_dk_/);
    expect(env.AUTHORITY_AGENT_ID).toMatch(/^[0-9a-f-]{36}$/);
    expect(env.GMAIL_CONNECTION_ID).toBe(connectionId);

    // No silent sharing: a brand-new customer of the same app cannot see the connection.
    const stranger = await api(request, "POST", "/api/v1/customers", env.AUTHORITY_BACKEND_API_KEY!, {
      externalId: `setup-flow-stranger-${suffix}`,
    });
    expect([200, 201]).toContain(stranger.status);
    const listed = await api(
      request,
      "GET",
      `/api/v1/customers/${stranger.json.customerId as string}/connections`,
      env.AUTHORITY_BACKEND_API_KEY!,
    );
    expect(listed.status).toBe(200);
    expect(
      (listed.json.connections as Array<{ connectionId: string }>).map((c) => c.connectionId),
    ).not.toContain(connectionId);
    const policies = (await managementQuery(
      `select scope from public.application_connection_access_policies where connection_id = '${connectionId}';`,
    )) as unknown[];
    expect(policies).toEqual([]);

    // Setup is now complete: the home page stops pointing to it.
    await page.goto("/app");
    await expect(page.getByTestId("setup-card")).toHaveCount(0);
  } finally {
    // Same rationale as auth-flows.spec.ts's fresh-signup test: the tenant itself can never be deleted
    // (authz.enforce_owner_survives), so only revoke what could be used -- every key this test minted -- and
    // disconnect the connection.
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
      update public.connector_connections set status = 'disconnected', disconnected_at = now()
        where status <> 'disconnected' and tenant_id in (
          select tenant_id from public.tenant_memberships where user_id = '${userId}');
    `);
  }
});
