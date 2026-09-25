import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { OWNER_A, OWNER_B, TENANT_A_ID, VIEWER_A } from "./support/users";

/**
 * Real identity and tenant membership in the application shell.
 *
 * The `authenticated` project supplies a stored session for OWNER_A. Tests
 * that need a different user clear that state and sign in explicitly.
 */

test.describe("authenticated identity", () => {
  test("the sidebar shows the real user, tenant and role", async ({ page }) => {
    await page.goto("/app");

    const sidebar = page.locator("aside");

    await expect(sidebar.getByText(OWNER_A.displayName)).toBeVisible();
    await expect(sidebar.getByText(OWNER_A.tenantName)).toBeVisible();
    await expect(sidebar.getByText(OWNER_A.roleLabel, { exact: true }).first()).toBeVisible();
  });

  test("the account menu shows the signed-in email", async ({ page }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: new RegExp(OWNER_A.displayName) }).click();

    const menu = page.getByRole("menu", { name: "Account" });
    await expect(menu.getByText(OWNER_A.email)).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  });

  test("the overview header names the real workspace, not a fixture", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByText(OWNER_A.tenantName).first()).toBeVisible();
  });

  test("product records are labelled as demo data", async ({ page }) => {
    await page.goto("/app");
    // The account is real; the tasks and agents below it are not, and the UI
    // has to say so rather than implying a live integration.
    await expect(page.getByText(/Demo data/i).first()).toBeVisible();
  });

  test("the workspace selector lists only the user's own memberships", async ({ page }) => {
    await page.goto("/app");

    await page.getByRole("button", { name: new RegExp(OWNER_A.tenantName) }).click();

    const menu = page.getByRole("menu", { name: "Switch workspace" });

    // Regression: Northwind has four members, and the memberships policy
    // deliberately exposes co-members so member administration can work. An
    // unfiltered query listed all four as separate workspaces. Exactly one
    // entry per tenant is the assertion that catches that.
    await expect(menu.getByRole("menuitemradio")).toHaveCount(1);
    await expect(menu.getByRole("menuitemradio", { name: new RegExp(OWNER_A.tenantName) })).toBeVisible();

    // The other tenant must not appear at all — not greyed out, not hidden.
    await expect(menu.getByText(OWNER_B.tenantName)).toHaveCount(0);
  });

  test("the current workspace is marked as selected", async ({ page }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: new RegExp(OWNER_A.tenantName) }).click();

    await expect(page.getByRole("menuitemradio", { name: new RegExp(OWNER_A.tenantName) })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

test.describe("cross-tenant isolation", () => {
  // Fresh context: this user must not inherit the stored OWNER_A session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a user in another tenant sees only their own workspace", async ({ page }) => {
    await signIn(page, OWNER_B);

    const sidebar = page.locator("aside");
    await expect(sidebar.getByText(OWNER_B.tenantName)).toBeVisible();
    await expect(sidebar.getByText(OWNER_A.tenantName)).toHaveCount(0);
  });

  test("a forged tenant cookie does not grant access to another tenant", async ({ page, context }) => {
    await signIn(page, OWNER_B);

    // Point the workspace preference at a tenant this user has no membership
    // in. The cookie is a preference, so the server must ignore it rather than
    // honour it.
    await context.addCookies([
      {
        name: "authority_tenant",
        value: TENANT_A_ID,
        domain: "127.0.0.1",
        path: "/",
      },
    ]);

    await page.goto("/app");

    // Resolution falls back to a real membership instead.
    await expect(page.locator("aside").getByText(OWNER_B.tenantName)).toBeVisible();
    await expect(page.locator("aside").getByText(OWNER_A.tenantName)).toHaveCount(0);
  });

  test("a malformed tenant cookie is ignored rather than erroring", async ({ page, context }) => {
    // Kept URL-safe: a cookie value cannot legally contain semicolons or
    // spaces, so the interesting case is a well-formed cookie carrying a value
    // that is not a tenant id.
    await signIn(page, OWNER_B);

    await context.addCookies([
      {
        name: "authority_tenant",
        value: "not-a-uuid-at-all",
        domain: "127.0.0.1",
        path: "/",
      },
    ]);

    await page.goto("/app");

    await expect(page.locator("aside").getByText(OWNER_B.tenantName)).toBeVisible();
  });
});

test.describe("roles within one tenant", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a viewer in the same tenant sees their own role, not the owner's", async ({ page }) => {
    await signIn(page, VIEWER_A);

    const sidebar = page.locator("aside");

    // Same tenant as OWNER_A.
    await expect(sidebar.getByText(VIEWER_A.tenantName)).toBeVisible();
    await expect(sidebar.getByText(VIEWER_A.displayName)).toBeVisible();
    await expect(sidebar.getByText(VIEWER_A.roleLabel, { exact: true }).first()).toBeVisible();
    await expect(sidebar.getByText(OWNER_A.displayName)).toHaveCount(0);
  });
});

test.describe("mobile dashboard drawer", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the drawer shows the real identity and workspace", async ({ page }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: "Menu" }).click();

    const drawer = page.getByRole("dialog", { name: "Control plane navigation" });
    await expect(drawer.getByText(OWNER_A.tenantName)).toBeVisible();
    await expect(drawer.getByText(OWNER_A.displayName)).toBeVisible();
  });
});
