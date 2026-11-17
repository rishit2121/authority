import { expect, test } from "@playwright/test";
import pg from "pg";

/**
 * A browser whose session was revoked server-side (signed out elsewhere, an expired refresh, a reset database) still
 * holds an access token whose signature verifies until it expires. The pages confirm the session with the Auth server
 * and send such a visitor to /login; /login must agree and show the form, not bounce them back to /app (which used to
 * loop until the browser gave up with "too many redirects"). The stale cookies are cleared and a fresh sign-in works.
 */

const PASSWORD = "Authority-Dev-2026!";
const OWNER_A = "owner.a@authority.test";

test("a revoked session lands on /login once and can sign in again", async ({ page, context }) => {
  const signIn = async () => {
    await page.getByLabel("Work email").fill(OWNER_A);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  };

  await page.goto("/login?next=%2Fapp%2Fsetup");
  await signIn();
  await expect(page).toHaveURL(/\/app\/setup/);

  const db = new pg.Client({ connectionString: process.env.DB_URL });
  await db.connect();
  try {
    await db.query(`delete from auth.sessions where user_id = (select id from auth.users where email = $1)`, [
      OWNER_A,
    ]);
  } finally {
    await db.end();
  }

  let redirects = 0;
  page.on("response", (response) => {
    if (response.status() >= 300 && response.status() < 400) redirects += 1;
  });
  await page.goto("/app/setup");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fsetup$/);
  await expect(page.getByLabel("Work email")).toBeVisible();
  expect(redirects).toBe(1);
  expect((await context.cookies()).filter((c) => c.name.startsWith("sb-"))).toHaveLength(0);

  await signIn();
  await expect(page).toHaveURL(/\/app\/setup/);
});
