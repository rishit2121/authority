import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

/**
 * The guided Setup page through the real dashboard, against a throwaway LOCAL Supabase (playwright.local.config.ts):
 * an admin chooses the app, connects Slack on its own page and comes back with the app kept, picks that connection,
 * shares it with their test customer only, makes one real protected call (Slack fixture mode: the in-process fake
 * Slack API, never slack.com) and sees the decision and receipt, which survive a refresh. A developer (non-admin)
 * sees "Needs access" and has nothing that could widen it.
 */

const PASSWORD = "Authority-Dev-2026!";
const OWNER_A = "owner.a@authority.test";
const DEV_A = "dev.a@authority.test";
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const PREFIX = "setup-guided-e2e";
const STAMP = `${PREFIX}-${Date.now().toString(36)}`;

let db: pg.Client;
let appId = "";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DB_URL });
  await db.connect();
  // Only one active Slack connection may exist per tenant: refuse to touch one this spec did not create.
  const active = await db.query<{ id: string; name: string }>(
    `select id, name from public.connector_connections
      where tenant_id = $1 and connector_id = 'slack' and status <> 'disconnected'`,
    [TENANT_A],
  );
  const foreign = active.rows.filter((r) => !r.name.startsWith(PREFIX));
  if (foreign.length > 0) {
    throw new Error(
      `Tenant A already has an active Slack connection ("${foreign[0]!.name}"); not touching it.`,
    );
  }
  await db.query(
    `update public.connector_connections set status = 'disconnected', disconnected_at = now()
      where tenant_id = $1 and connector_id = 'slack' and status <> 'disconnected' and name like $2`,
    [TENANT_A, `${PREFIX}%`],
  );
  // A dedicated app, so the tenant has several and the page must ask which one.
  appId = (
    await db.query(
      `insert into public.applications (tenant_id, name, slug, environment)
       values ($1, $2, $2, 'production') returning id`,
      [TENANT_A, STAMP],
    )
  ).rows[0].id;
  // The developer must be past the invite-only gate to see the dashboard at all.
  await db.query(
    `insert into public.pilot_access (email, email_normalized, source, status)
     values ($1, $1, 'manual', 'approved')
     on conflict (email_normalized) do update set status = 'approved'`,
    [DEV_A],
  );
});

test.afterAll(async () => {
  await db?.query(
    `update public.connector_connections set status = 'disconnected', disconnected_at = now()
      where tenant_id = $1 and name like $2 and status <> 'disconnected'`,
    [TENANT_A, `${PREFIX}%`],
  );
  await db?.query(
    `update public.developer_backend_credentials set status = 'revoked', revoked_at = now(),
        revocation_reason = 'setup-guided e2e cleanup'
      where application_id = $1 and status = 'active'`,
    [appId],
  );
  await db?.end();
});

test("an admin goes from app choice to a protected call with only their test customer shared", async ({
  page,
  browser,
}) => {
  await signIn(page, OWNER_A);
  await page.goto("/app/setup");

  // Live is the default; the sample path is a separate, labelled choice.
  await expect(page.getByTestId("setup-entry-live")).toHaveAttribute("aria-current", "page");
  // Several apps: nothing proceeds until one is chosen.
  await expect(page.getByTestId("setup-app-select")).toHaveValue("");
  await expect(page.getByTestId("setup-connection-cards")).toHaveCount(0);
  await page.getByTestId("setup-app-select").selectOption({ label: STAMP });
  await expect(page).toHaveURL(new RegExp(`app=${appId}`));

  // Connect Slack on its own page; it links back to this step with the app kept.
  await expect(page.getByTestId("setup-card-slack")).toContainText("Workspace bot token");
  await expect(page.getByTestId("setup-card-gmail")).toContainText("Google account consent (OAuth)");
  await page.getByTestId("setup-connect-slack").click();
  await expect(page).toHaveURL(/\/app\/integrations\/slack\?returnTo=/);
  await page.getByTestId("slack-name").fill(STAMP);
  await page.getByTestId("slack-connect").click();
  const findConnection = async () =>
    (await db.query<{ id: string }>(`select id from public.connector_connections where name = $1`, [STAMP]))
      .rows[0]?.id;
  await expect.poll(findConnection).toBeTruthy();
  const connectionId = (await findConnection())!;
  const card = page.getByTestId(`slack-connection-${connectionId}`);
  await card.getByTestId("slack-bot-token-value").fill("xoxb-fixture-setup-guided");
  await card.getByTestId("slack-save-bot-token").click();
  await expect(card.getByText("Bot token saved.")).toBeVisible();
  await page.getByTestId("back-to-setup").click();
  await expect(page).toHaveURL(new RegExp(`/app/setup\\?app=${appId}$`));

  // Pick exactly that connection, then confirm it.
  await expect(page.getByTestId(`setup-connection-state-${connectionId}`)).toHaveText("Needs access");
  await expect(page.getByTestId(`setup-connection-state-${connectionId}`).locator("..")).toContainText(
    "not verified yet",
  );
  await page.getByTestId(`setup-connection-${connectionId}`).check();
  await page.getByTestId("setup-use-connection").click();
  await expect(page).toHaveURL(new RegExp(`connection=${connectionId}`));

  // Who can use it, shown before anything changes; the call is not possible yet.
  await expect(page.getByTestId("setup-access-summary")).toHaveText("Only admins (no customers yet)");
  await expect(page.getByTestId("setup-make-call")).toBeDisabled();
  await page.getByTestId("setup-share-test-customer").click();
  await expect(page.getByTestId("setup-access-summary")).toHaveText("Shared with 1 specific customer");
  await expect(page.getByTestId("setup-chosen-state")).toHaveText("Ready for this customer");
  // The wider share is optional and was not used.
  const policies = await db.query(
    `select scope from public.application_connection_access_policies where connection_id = $1`,
    [connectionId],
  );
  expect(policies.rows).toEqual([]);

  // One real protected call.
  await page.getByTestId("setup-make-call").click();
  await expect(page.getByTestId("setup-call-label")).toHaveText("Allowed", { timeout: 30_000 });
  await expect(page.getByTestId("setup-call-result")).toContainText("2 channels");
  await expect(page).toHaveURL(/task=[0-9a-f-]{36}/);
  await expect(page.getByTestId("setup-recorded-label")).toHaveText("Allowed");
  await expect(page.getByTestId("setup-recorded-receipt")).not.toHaveText("none");
  const env = (await page.getByTestId("setup-env").locator("code").textContent()) ?? "";
  expect(env).toMatch(/AUTHORITY_BACKEND_API_KEY=authority_dk_/);
  expect(env).toContain(`SLACK_CONNECTION_ID=${connectionId}`);
  await expect(page.getByTestId("setup-sample-code")).toContainText("slack.list_channels");
  await expect(page.getByTestId("setup-sample-code")).not.toContainText("authority_dk_");

  // A refresh keeps the step and the recorded decision, and never shows the keys again.
  await page.reload();
  await expect(page.getByTestId("setup-recorded-label")).toHaveText("Allowed");
  await expect(page.getByTestId("setup-env")).not.toContainText("authority_dk_");
  await expect(page.getByTestId("setup-issue-keys")).toBeVisible();
  expect(
    (
      await db.query(
        `select scope from public.application_connection_access_policies where connection_id = $1`,
        [connectionId],
      )
    ).rows,
  ).toEqual([]);

  // A developer sees the same connection as needing access, and nothing that could widen it.
  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, DEV_A);
  await dev.goto(`/app/setup?app=${appId}&connection=${connectionId}`);
  await expect(dev.getByTestId("setup-access-summary")).toHaveText("Shared with 1 specific customer");
  await expect(dev.getByTestId("setup-access-ask-admin")).toContainText("Ask an owner or admin");
  await expect(dev.getByTestId("setup-share-test-customer")).toHaveCount(0);
  await expect(dev.getByTestId("setup-share-all")).toHaveCount(0);
  await expect(dev.getByTestId("setup-make-call")).toHaveCount(0);
  await expect(dev.getByTestId("setup-connect-slack")).toHaveCount(0);
});

test("the sample path is labelled and never live", async ({ page }) => {
  await signIn(page, OWNER_A);
  await page.goto("/app/setup?mode=sample");
  await expect(page.getByTestId("setup-sample")).toContainText("Sample · no accounts connected");
  await expect(page.getByTestId("setup-step-2")).toHaveCount(0);
});
