import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

/**
 * The 100+ service catalog and the shared connect page for declarative REST connectors, against a throwaway LOCAL
 * Supabase. Nothing here reaches a provider: the only submission is one the page refuses before saving or calling
 * anything (a subdomain that would move the host).
 */

const PASSWORD = "Authority-Dev-2026!";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("the catalog lists 100+ services, searches and filters by category", async ({ page }) => {
  await signIn(page, "owner.a@authority.test");
  await page.goto("/app/integrations");
  const count = page.getByTestId("catalog-count");
  const total = Number((await count.innerText()).match(/\d+/)![0]);
  expect(total).toBeGreaterThanOrEqual(100);
  await page.getByTestId("catalog-search").fill("jira");
  await expect(count).toHaveText(`1 of ${total}`);
  await expect(page.getByTestId("jira-integration-link")).toBeVisible();
  await page.getByTestId("catalog-search").fill("");
  await page.getByTestId("catalog-category-Customer support").click();
  await expect(page.getByTestId("zendesk-integration-link")).toBeVisible();
  await expect(page.getByTestId("jira-integration-link")).toHaveCount(0);
});

test("a connect page refuses a setting that would move the host, before saving anything", async ({
  page,
}) => {
  await signIn(page, "owner.a@authority.test");
  await page.goto("/app/integrations/zendesk");
  await expect(page.getByTestId("rest-operations").locator("li")).toHaveCount(4);
  await page.getByTestId("rest-name").fill("catalog-e2e");
  await page.getByTestId("rest-config-subdomain").fill("evil.example#");
  await page.getByTestId("rest-config-email").fill("agent@acme.test");
  await page.getByTestId("rest-secret").fill("not-a-real-token");
  await page.getByTestId("rest-connect").click();
  await expect(page.getByTestId("rest-result")).toHaveText(/Zendesk subdomain/);
  await page.reload();
  await expect(page.getByText("catalog-e2e")).toHaveCount(0);
});

test("unknown connectors are 404 and a developer sees no connect form", async ({ page, browser }) => {
  await signIn(page, "owner.a@authority.test");
  const response = await page.goto("/app/integrations/not-a-real-connector");
  expect(response?.status()).toBe(404);

  // The developer must be past the invite-only gate to see the dashboard at all.
  const db = new pg.Client({ connectionString: process.env.DB_URL });
  await db.connect();
  try {
    await db.query(
      `insert into public.pilot_access (email, email_normalized, source, status)
       values ($1, $1, 'manual', 'approved')
       on conflict (email_normalized) do update set status = 'approved'`,
      ["dev.a@authority.test"],
    );
  } finally {
    await db.end();
  }
  const dev = await (await browser.newContext()).newPage();
  await signIn(dev, "dev.a@authority.test");
  await dev.goto("/app/integrations/sentry");
  await expect(dev.getByTestId("rest-operations")).toBeVisible();
  await expect(dev.getByTestId("rest-connect")).toHaveCount(0);
});
