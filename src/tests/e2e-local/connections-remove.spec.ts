import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

/**
 * Removing a disconnected connection from the dashboard: browser -> server action -> signed-in Supabase client ->
 * public.remove_connector_connection. The connection is archived (hidden), not deleted. Local Supabase only.
 */

const PASSWORD = "Authority-Dev-2026!";
const OWNER_A = "owner.a@authority.test";
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const CONNECTOR_ID = `custom_e2eremove${Date.now().toString(36)}`;

let db: pg.Client;
let connectionId = "";

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
  // The pilot gate (another spec turns it on) only blocks onboarding; the owner is eligible either way.
  await db.query(`update public.pilot_settings set owner_email = $1 where id`, [OWNER_A]);
  connectionId = (
    await db.query(
      `insert into public.connector_connections (tenant_id, connector_id, name, status, disconnected_at)
       values ($1, $2, 'e2e old connection', 'disconnected', now()) returning id`,
      [TENANT_A, CONNECTOR_ID],
    )
  ).rows[0].id;
});

test.afterAll(async () => {
  await db?.end();
});

test("an owner removes a disconnected Custom API connection from the page; its history is kept", async ({
  page,
}) => {
  await signIn(page, OWNER_A);
  await page.goto("/app/integrations/custom-api");
  const card = page.getByTestId(`custom-api-connection-${CONNECTOR_ID}`);
  await expect(card).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTestId(`custom-api-remove-${CONNECTOR_ID}`).click();

  await expect(card).toBeHidden();
  const row = (
    await db.query(`select archived_at from public.connector_connections where id = $1`, [connectionId])
  ).rows[0];
  expect(row.archived_at).not.toBeNull();
});
