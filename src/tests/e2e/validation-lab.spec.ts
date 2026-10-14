import { expect, test } from "@playwright/test";

import { managementQuery } from "../integration/support";

const TENANT_A = "11111111-1111-4111-8111-111111111111";

async function purge() {
  await managementQuery(`
    set local role postgres;
    select set_config('authority.allow_demo_purge', 'on', true);
    delete from public.validation_campaigns where tenant_id = '${TENANT_A}';
    delete from public.validation_regressions where tenant_id = '${TENANT_A}';
    delete from public.validation_environments where tenant_id = '${TENANT_A}';
    delete from public.validation_scenario_versions where tenant_id = '${TENANT_A}';
  `);
}

/**
 * The Validation Lab through the real UI: create an environment, run an attack campaign against a deliberately
 * weakened control, inspect the failure (expected vs actual, responsible control, blast radius), accept a remediation,
 * watch it verify, and see the regression test appear. Everything runs in throwaway sandbox tenants.
 */
test.describe.serial("validation lab", () => {
  test.beforeAll(purge);
  test.afterAll(purge);

  test("is reachable from the navigation and labels results as synthetic", async ({ page }) => {
    await page.goto("/app");
    const nav = page.getByRole("navigation", { name: "Control plane" });
    await nav.getByRole("button", { name: "Advanced" }).click();
    await nav.getByRole("link", { name: "Validation Lab" }).click();
    await expect(page).toHaveURL(/\/app\/validation$/);
    await expect(page.getByRole("heading", { level: 1, name: "Validation Lab" })).toBeVisible();
    await expect(page.getByText("synthetic", { exact: true }).first()).toBeVisible();
    for (const tab of [
      "Environments",
      "Scenario library",
      "Campaign builder",
      "Runs",
      "Findings",
      "Remediations",
      "Regression history",
    ])
      await expect(
        page.getByRole("navigation", { name: "Validation Lab" }).getByRole("link", { name: tab }),
      ).toBeVisible();
  });

  test("lists the scenario library with taxonomy labels", async ({ page }) => {
    await page.goto("/app/validation/scenarios");
    await expect(page.getByText(/28 versioned, immutable scenarios/)).toBeVisible();
    await expect(page.getByText("Unrelated-recipient substitution").first()).toBeVisible();
  });

  test("runs a campaign that finds a real gap, then accepts a remediation and verifies it", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/app/validation");
    await page.getByLabel("Name").fill("e2e environment");
    await page.getByRole("button", { name: "Create environment" }).click();
    await expect(page.getByText("e2e environment").first()).toBeVisible();

    await page.goto("/app/validation/campaigns/new?scenarios=recipient-substitution");
    await page.getByLabel("baseline").uncheck();
    await page.getByLabel("unpinned-recipient").check();
    await page.getByRole("button", { name: "Start campaign" }).click();

    await expect(page).toHaveURL(/\/app\/validation\/campaigns\/[0-9a-f-]{36}$/);
    await expect(page.getByText("completed", { exact: true }).first()).toBeVisible({ timeout: 90_000 });

    // Failure explained: expected vs actual, responsible control, blast radius, findings, measurements.
    await expect(page.getByRole("table", { name: "Expected versus actual outcome" })).toBeVisible();
    await expect(page.getByText("responsible control").first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Blast radius" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Findings for this run" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Measurements" })).toContainText("False negatives");
    await expect(page.getByText("Never broadens authority").first()).toBeVisible();

    // Reports are downloadable and contain no raw arguments.
    const url = page.url();
    const id = url.split("/").pop()!;
    const json = await page.request.get(`/api/validation/campaigns/${id}/report?format=json`);
    expect(json.status()).toBe(200);
    const text = await json.text();
    expect(text).toContain("synthetic");
    expect(text.match(/argumentValues|\.evil\.example|sk_live|ghp_|Bearer /g)).toBeNull();
    expect(text).toContain("Pin the to argument of gmail.send_email");
    expect((await page.request.get(`/api/validation/campaigns/${id}/report?format=md`)).status()).toBe(200);
    expect((await page.request.get(`/api/validation/campaigns/${id}/report?format=html`)).status()).toBe(200);

    // Accept the narrowing remediation: a regression test appears and the verification run passes.
    await page.goto("/app/validation/remediations");
    const card = page.locator("article", { hasText: "Narrow resource binding" }).first();
    await card.getByLabel("Decision note (optional)").fill("pin the recipient");
    await card.getByRole("button", { name: "Accept and verify" }).click();
    await expect(page.locator("article").getByText("verified", { exact: true }).first()).toBeVisible({
      timeout: 120_000,
    });
    await page.goto("/app/validation/regressions");
    await expect(page.getByText(/regression\.recipient-substitution\./).first()).toBeVisible();
    await expect(page.getByText("1 of 1 passing")).toBeVisible();
  });

  test("the campaign page does not overflow on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app/validation/campaigns");
    await page.locator('a[href*="/app/validation/campaigns/"]:not([href$="/new"])').first().click();
    await expect(page.getByRole("region", { name: "Blast radius" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
  });
});
