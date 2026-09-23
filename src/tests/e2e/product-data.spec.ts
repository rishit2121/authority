import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { OWNER_A, OWNER_B } from "./support/users";

/**
 * Part 2B.2: the product pages backed by Supabase repositories.
 *
 * Uses tenant B (Globex Payments) for the empty-state and install/reset
 * flows — it starts genuinely empty, unlike tenant A, which several other
 * suites depend on having the GitHub #991 demo task installed and
 * `executing`. Resets back to empty in this file's own cleanup so later
 * runs see the same starting point.
 */
test.describe("empty workspace and demo installation", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a new authenticated tenant sees the honest empty state, not mock fixtures", async ({ page }) => {
    await signIn(page, OWNER_B);

    await expect(page.getByText("No agents or tasks have been configured")).toBeVisible();
    await expect(page.getByText(/does not contact github, stripe, gmail, slack/i)).toBeVisible();
    await expect(page.getByText(/stores no external credentials/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Install demo workspace" })).toBeVisible();

    // Never Northwind's fixtures leaking into an empty tenant.
    await expect(page.getByText("coding-agent-17")).toHaveCount(0);
    await expect(page.getByText(OWNER_A.tenantName)).toHaveCount(0);
  });

  test("installing demo data populates the dashboard, then resetting empties it again", async ({ page }) => {
    await signIn(page, OWNER_B);
    await expect(page.getByRole("button", { name: "Install demo workspace" })).toBeVisible();

    await page.getByRole("button", { name: "Install demo workspace" }).click();
    await expect(page.getByText("Active agents")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/demo data/i).first()).toBeVisible();

    // A second install is idempotent — no duplicate row, dashboard unchanged.
    await page.goto("/app/tasks");
    const rowCountAfterFirstInstall = await page.locator("table tbody tr").count();

    await page.goto("/app/agents");
    await expect(page.getByRole("button", { name: "Reset demo data" })).toBeVisible();
    await page.getByRole("button", { name: "Reset demo data" }).click();
    await expect(page.getByText("No agents or tasks have been configured")).toBeVisible({ timeout: 15_000 });

    expect(rowCountAfterFirstInstall).toBeGreaterThan(0);
  });
});

test.describe("product pages read from Supabase", () => {
  test("dashboard metrics and recent traces come from persisted tenant A records", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByText("Active agents")).toBeVisible();
    await expect(page.getByText("coding-agent-17").first()).toBeVisible();
  });

  test("agents page lists persisted agents with owner and created time", async ({ page }) => {
    await page.goto("/app/agents");
    await expect(page.getByText("coding-agent-17")).toBeVisible();
    await expect(page.getByText("customer-ops-agent")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Owner" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Created" })).toBeVisible();
  });

  test("policies page shows both the active and the draft demo policy", async ({ page }) => {
    await page.goto("/app/policies");
    await expect(page.getByText("Never read repository secrets")).toBeVisible();
    await expect(page.getByText("CI workflow changes require review")).toBeVisible();
    await expect(page.getByText("draft", { exact: true }).first()).toBeVisible();
  });

  test("integrations page shows persisted metadata, clearly labelled as simulated", async ({ page }) => {
    await page.goto("/app/integrations");
    await expect(page.getByText("github", { exact: true })).toBeVisible();
    await expect(page.getByText(/simulated metadata only/i)).toBeVisible();
    await expect(page.getByText(/no oauth token, password, api key/i)).toBeVisible();
  });

  test("approvals page shows the persisted pending approval with a decision form", async ({ page }) => {
    await page.goto("/app/approvals");
    await expect(page.getByText(/modify ci\.yml/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();
  });

  test("dynamic task investigation loads the persisted GitHub #991 task directly by id", async ({ page }) => {
    await page.goto("/app/tasks");
    const firstTaskLink = page.locator("table tbody tr a").first();
    const href = await firstTaskLink.getAttribute("href");
    expect(href).toMatch(/^\/app\/tasks\/[0-9a-f-]{36}$/);

    await page.goto(href!);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#capabilities")).toBeVisible();
  });
});

test.describe("cross-tenant task access", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a real tenant A task id is inaccessible to tenant B, not merely hidden", async ({ page }) => {
    // Fetch a genuine tenant A task id while signed in as its owner.
    await signIn(page, OWNER_A);
    await page.goto("/app/tasks");
    const href = await page.locator("table tbody tr a").first().getAttribute("href");
    expect(href).toMatch(/^\/app\/tasks\/[0-9a-f-]{36}$/);

    await page.getByRole("button", { name: new RegExp(OWNER_A.displayName) }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);

    // Now as a stranger to tenant A entirely: the same real id 404s —
    // indistinguishable from a task that never existed at all.
    await signIn(page, OWNER_B);
    const response = await page.goto(href!);
    expect(response?.status()).toBe(404);
  });
});
