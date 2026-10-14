import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { OWNER_B } from "./support/users";

/**
 * The operator-only Metrics page. playwright.config.ts sets
 * PLATFORM_ADMIN_EMAILS to owner A for this test server, so the stored owner A
 * session is an operator and owner B (a workspace owner, but not an
 * operator) is not.
 */
test.describe("platform metrics", () => {
  test("an operator sees real usage numbers from the sidebar", async ({ page }) => {
    await page.goto("/app");
    const nav = page.getByRole("navigation", { name: "Control plane" });
    await nav.getByRole("link", { name: /^Metrics/ }).click();
    await expect(page).toHaveURL(/\/app\/admin$/);
    await expect(page.getByRole("heading", { level: 1, name: "Metrics" })).toBeVisible();
    for (const label of [
      "Users",
      "New users (7 days)",
      "Active workspaces (7 days)",
      "Tool calls (7 days)",
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Setup funnel" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent signups" })).toBeVisible();
    // Fixture accounts never count as real users.
    await expect(page.getByRole("table").getByText(/@authority\.test/)).toHaveCount(0);
  });

  test.describe("a workspace owner who is not an operator", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("gets no link and a 404", async ({ page }) => {
      await signIn(page, OWNER_B);
      await expect(
        page.getByRole("navigation", { name: "Control plane" }).getByRole("link", { name: /^Metrics/ }),
      ).toHaveCount(0);
      const response = await page.goto("/app/admin");
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "Setup funnel" })).toHaveCount(0);
    });
  });
});
