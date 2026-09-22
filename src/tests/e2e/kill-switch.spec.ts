import { expect, test } from "@playwright/test";

/**
 * The kill-switch flow on the GitHub #991 task: confirm-before-act, cancel
 * leaves state untouched, and confirming produces every effect the task
 * investigation view is supposed to show.
 */
test.describe("kill switch", () => {
  test("task starts executing with active capabilities", async ({ page }) => {
    await page.goto("/app/tasks/demo-task");
    await expect(page.getByText("executing", { exact: true })).toBeVisible();

    const capabilities = page.locator("#capabilities");
    await expect(capabilities.getByText("active", { exact: true }).first()).toBeVisible();
  });

  test("cancelling the confirmation changes nothing", async ({ page }) => {
    await page.goto("/app/tasks/demo-task");

    await page.getByRole("button", { name: "Revoke all authority" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();

    // Still executing, kill switch still armed rather than fired.
    await expect(page.getByText("executing", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Revoke all authority" })).toBeVisible();
    await expect(page.getByText("Task terminated")).toBeHidden();
  });

  test("confirming terminates the task and revokes capabilities", async ({ page }) => {
    await page.goto("/app/tasks/demo-task");

    const capabilities = page.locator("#capabilities");
    const timeline = page.locator("#timeline");
    const timelineEventsBefore = await timeline.getByRole("listitem").count();

    await page.getByRole("button", { name: "Revoke all authority" }).click();
    await page.getByRole("button", { name: "Confirm revocation" }).click();

    // Task becomes terminated.
    await expect(page.getByRole("heading", { name: "Task terminated" })).toBeVisible();
    await expect(page.getByText("terminated", { exact: true })).toBeVisible();

    // Active capabilities become revoked.
    await expect(capabilities.getByText("active", { exact: true })).toHaveCount(0);
    await expect(capabilities.getByText("Kill switch").first()).toBeVisible();

    // Execution timeline gains an event.
    await expect(timeline.getByRole("listitem")).toHaveCount(timelineEventsBefore + 1);
    await expect(timeline.getByText(/kill switch engaged/i)).toBeVisible();

    // States plainly that nothing external was contacted.
    await expect(page.getByText(/no external system is contacted/i)).toBeVisible();
  });
});
