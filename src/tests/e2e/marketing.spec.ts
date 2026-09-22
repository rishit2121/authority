import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { OWNER_A } from "./support/users";

/**
 * The end-to-end marketing flow: headline, the authority graph existing on
 * the page, the walkthrough, and the denied-secret assertion on the full
 * task investigation. Assertions are on content and state, never on
 * animation timing or exact pixel positions.
 */
test.describe("marketing flow", () => {
  test("loads the homepage and shows the product headline", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Give every AI agent exactly the authority its task requires.",
    );
  });

  test("renders the central authority graph", async ({ page }) => {
    await page.goto("/");
    const graph = page.getByRole("group", { name: "Authority graph, animated" });
    await expect(graph).toBeVisible();
    // The agent core is the accessible description's anchor; the SVG itself
    // is presentational (aria-hidden), so assert on the text equivalent.
    await expect(page.locator("#authority-graph-description")).toContainText("customer-ops-agent");
  });

  test("opens the walkthrough via See how it works and navigates it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "See how it works" }).click();
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
