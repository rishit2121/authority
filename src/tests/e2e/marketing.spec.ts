import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { OWNER_A } from "./support/users";

/**
 * The end-to-end marketing flow (design/frontend-simplification): headline,
 * the scope graph's accessibility surface, reduced motion, mobile overflow,
 * the signed-in header state, and the walkthrough handoff. Assertions are on
 * content and state, never on animation timing or exact pixel positions.
 */
test.describe("marketing flow", () => {
  test("loads the homepage and shows the product headline", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Let agents act.");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Keep authority bounded.");
  });

  test("the primary call to action leads to a working self-serve signup, not a dead end", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Start with a task" }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("the header's primary CTA says Start building when signed out", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner").getByRole("link", { name: "Start building" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Open console" })).toHaveCount(0);
  });

  test("the header's primary CTA says Open console when signed in", async ({ page }) => {
    await signIn(page, OWNER_A);
    await page.goto("/");
    await expect(page.getByRole("banner").getByRole("link", { name: "Open console" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Start building" })).toHaveCount(0);
  });

  test("renders the animated scope graph with an accessible description", async ({ page }) => {
    await page.goto("/");
    const graph = page.getByRole("group", { name: "Authority field, animated" });
    await expect(graph).toBeVisible();
    // The SVG itself is presentational (aria-hidden); the sr-only description carries the meaning.
    const description = page.locator("#scope-graph-description");
    await expect(description).toContainText("Refund order #4821");
    await expect(description).toContainText("Zero standing permissions remain.");
    await expect(graph.getByRole("button", { name: "Replay" })).toBeVisible();
  });

  test("the graph shows a fully static end state and no pause control under reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const graph = page.getByRole("group", { name: "Authority field, animated" });
    await expect(graph).toBeVisible();
    await expect(graph.getByRole("button", { name: "Pause" })).toHaveCount(0);
    await expect(graph.getByText("0 standing permissions")).toBeVisible();
  });

  test("the page has no horizontal overflow on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("the mobile menu is reachable and lists the primary navigation plus a CTA", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const menuButton = page.getByRole("button", { name: "Open menu" });
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    const panel = page.locator("#mobile-nav-panel");
    await expect(panel.getByRole("link", { name: "Product" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Start building" })).toBeVisible();
  });

  test("opens the walkthrough via View a live trace and navigates it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "View a live trace" }).click();
    await expect(page).toHaveURL(/\/demo$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("One task, nine decisions");

    const walkthrough = page.getByRole("group", { name: "Runtime authorization walkthrough" });
    await expect(walkthrough.getByRole("heading", { name: "Trusted task received" })).toBeVisible();

    await walkthrough.getByRole("button", { name: "Next" }).click();

    // The walkthrough uses AnimatePresence mode="wait", so the outgoing step
    // unmounts fully before the incoming one mounts. Asserting the old
    // heading is gone first pins the test to that sequence instead of racing
    // the ~220ms window in which neither heading is in the DOM.
    await expect(walkthrough.getByRole("heading", { name: "Trusted task received" })).toHaveCount(0);
    await expect(walkthrough.getByRole("heading", { name: "Task Authority Contract created" })).toBeVisible();

    // Step indicator lets you jump directly to a later step. Each button's
    // accessible name is "Step N of 9: <title>", not its visible "N. Label" text.
    await walkthrough.getByRole("button", { name: /Step 5 of 9/ }).click();
    await expect(walkthrough.getByRole("heading", { name: "Secret access denied" })).toBeVisible();
    await expect(walkthrough.getByText("Deny", { exact: true })).toBeVisible();
  });

  test("opens the full task investigation and confirms secret access was denied", async ({ page }) => {
    // The walkthrough hands off into /app, which is protected server-side as
    // of Part 2A. Signing in first keeps this test covering the whole journey
    // from the public demo through to the investigation view, rather than
    // stopping at the login redirect.
    await signIn(page, OWNER_A);

    await page.goto("/demo");
    await page.getByRole("link", { name: "Open the full task investigation" }).click();
    await expect(page).toHaveURL(/\/app\/tasks\/demo-task$/);

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Resolve issue #991");

    const boundary = page.locator("#boundary");
    await expect(boundary.getByText("Read repository secrets")).toBeVisible();

    const evidence = page.locator("#evidence");
    await expect(evidence.getByText("FORBIDDEN_RESOURCE")).toBeVisible();
    await expect(evidence.getByText(/github\.get_repository_secret/)).toBeVisible();
    await expect(evidence.getByText("Deny").first()).toBeVisible();
  });
});
