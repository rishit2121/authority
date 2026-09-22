import { expect, test, type Page } from "@playwright/test";

const NAV_LINKS: Array<{ name: string; href: string; heading: string | RegExp }> = [
  { name: "Tasks", href: "/app/tasks", heading: "Tasks" },
  { name: "Agents", href: "/app/agents", heading: "Agents" },
  { name: "Policies", href: "/app/policies", heading: "Policies" },
  { name: "Integrations", href: "/app/integrations", heading: "Integrations" },
  { name: "Approvals", href: "/app/approvals", heading: "Approvals" },
  { name: "Settings", href: "/app/settings", heading: "Settings" },
];

function desktopSidebar(page: Page) {
  return page.getByRole("navigation", { name: "Control plane" });
}

test.describe("dashboard navigation", () => {
  test("loads the overview with every nav group and link present", async ({ page }) => {
    await page.goto("/app");
    const sidebar = desktopSidebar(page);

    for (const group of ["Monitor", "Control", "System"]) {
      await expect(sidebar.getByText(group, { exact: true })).toBeVisible();
    }
    for (const label of [
      "Overview",
      "Tasks",
      "Agents",
      "Policies",
      "Integrations",
      "Approvals",
      "Settings",
    ]) {
      await expect(sidebar.getByRole("link", { name: new RegExp(label) })).toBeVisible();
    }
  });

  test("Overview is marked as the current page on load", async ({ page }) => {
    await page.goto("/app");
    await expect(desktopSidebar(page).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  for (const { name, href, heading } of NAV_LINKS) {
    test(`navigates to ${name} and marks it current`, async ({ page }) => {
      await page.goto("/app");
      await desktopSidebar(page)
        .getByRole("link", { name: new RegExp(`^${name}`) })
        .click();
      await expect(page).toHaveURL(new RegExp(href.replace(/\//g, "\\/") + "$"));
      await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
      await expect(desktopSidebar(page).getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
  }

  test("collapses and expands the desktop sidebar, persisting the preference", async ({ page }) => {
    await page.goto("/app");
    const aside = page.locator("aside");
    const initialBox = await aside.boundingBox();

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(async () => {
      const box = await aside.boundingBox();
      expect(box?.width).toBeLessThan(100);
    }).toPass();

    // Labels move to accessible names + hover-only tooltips instead of
    // visible text (the tooltip span itself is `aria-hidden` and only
    // perceptible on hover/focus, so assert its resting opacity rather than
    // DOM presence).
    await expect(desktopSidebar(page).locator("span.truncate")).toHaveCount(0);
    await expect(desktopSidebar(page).getByRole("link", { name: "Overview" })).toBeVisible();
    const tooltip = desktopSidebar(page).getByText("Overview", { exact: true });
    await expect(tooltip).toHaveCSS("opacity", "0");

    await page.reload();
    await expect(async () => {
      const box = await aside.boundingBox();
      expect(box?.width).toBeLessThan(100);
    }).toPass();

    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(async () => {
      const box = await aside.boundingBox();
      expect(box?.width).toBeGreaterThan(initialBox!.width - 10);
    }).toPass();
  });

  test("mobile drawer opens, closes on Escape, and restores focus to the trigger", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app");

    const trigger = page.getByRole("button", { name: "Menu" });
    await trigger.focus();
    await trigger.click();

    const drawer = page.getByRole("dialog", { name: "Control plane navigation" });
    await expect(drawer).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("mobile drawer closes and navigates when a route is selected", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app");

    await page.getByRole("button", { name: "Menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Control plane navigation" });
    await drawer.getByRole("link", { name: /^Tasks/ }).click();

    await expect(page).toHaveURL(/\/app\/tasks$/);
    await expect(drawer).toBeHidden();
  });

  test("background scroll is locked while the mobile drawer is open", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app");

    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("dialog", { name: "Control plane navigation" })).toBeVisible();

    const overflow = await page.evaluate(() => document.body.style.overflow);
    expect(overflow).toBe("hidden");
  });
});
