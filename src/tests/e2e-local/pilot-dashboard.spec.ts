import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

/**
 * The invite-only pilot through the real dashboard: browser -> server
 * action -> signed-in Supabase client -> PostgREST (pg-safeupdate loaded) ->
 * RPC. Local Supabase only (see playwright.local.config.ts).
 */

const PASSWORD = "Authority-Dev-2026!";
const OWNER_A = "owner.a@authority.test";
const VIEWER_A = "viewer.a@authority.test";

let db: pg.Client;

async function gate(): Promise<boolean> {
  return (await db.query(`select gate_enabled from public.pilot_settings`)).rows[0].gate_enabled;
}

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
  await db.query(`update public.pilot_settings set owner_email = $1, gate_enabled = true where id`, [
    OWNER_A,
  ]);
  await db.query(`delete from public.pilot_access where true`);
});

test.afterAll(async () => {
  await db?.query(`update public.pilot_settings set gate_enabled = true where id`);
  await db?.end();
});

test("the owner turns the gate off and back on from the dashboard", async ({ page }) => {
  await signIn(page, OWNER_A);
  await page.goto("/app/pilot");
  await expect(page.getByRole("heading", { name: "Invite-only gate: On" })).toBeVisible();

  await page.getByRole("button", { name: "Turn gate off" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByText("That didn't save")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Invite-only gate: Off" })).toBeVisible();
  expect(await gate()).toBe(false);

  await page.getByRole("button", { name: "Turn gate on" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Invite-only gate: On" })).toBeVisible();
  expect(await gate()).toBe(true);
});

test("an unapproved user is held at invite-only until the owner approves them", async ({ browser }) => {
  const viewer = await (await browser.newContext()).newPage();
  await signIn(viewer, VIEWER_A);
  await expect(viewer).toHaveURL(/\/invite-only$/);
  await expect(viewer.getByRole("heading", { name: "Authority is currently invite-only" })).toBeVisible();
  await viewer.goto("/app/pilot");
  await expect(viewer).toHaveURL(/\/invite-only$/);

  const owner = await (await browser.newContext()).newPage();
  await signIn(owner, OWNER_A);
  await owner.goto("/app/pilot");
  await owner.getByPlaceholder("dev@company.com").fill(VIEWER_A);
  await owner.getByRole("button", { name: "Approve email" }).click();
  await expect(owner.getByText("Saved.")).toBeVisible();

  await viewer.goto("/app");
  await expect(viewer).toHaveURL(/\/app/);
  await expect(viewer.getByRole("heading", { name: "Authority is currently invite-only" })).toHaveCount(0);
  // Approved, but not the owner: the pilot dashboard does not exist for them.
  const response = await viewer.goto("/app/pilot");
  expect(response?.status()).toBe(404);
  expect(await gate()).toBe(true);
});
