import { expect, test, type Page } from "@playwright/test";

const ROUTES = [
  "/",
  "/demo",
  "/app",
  "/app/tasks",
  "/app/tasks/new",
  "/app/tasks/demo-task",
  "/app/agents",
  "/app/policies",
  "/app/integrations",
  "/app/approvals",
  "/app/runtime",
  "/app/settings",
  "/app/validation",
  "/app/validation/scenarios",
  "/app/validation/campaigns/new",
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
];

async function collectConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.describe("layout: no horizontal overflow", () => {
  for (const viewport of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`${route || "/"} has no horizontal overflow at ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(route);
        await page.waitForLoadState("networkidle");

        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      });
    }
  }
});

test.describe("layout: no console errors", () => {
  for (const route of ROUTES) {
    test(`${route || "/"} produces no console errors`, async ({ page }) => {
      const errors = await collectConsoleErrors(page);
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      expect(errors).toEqual([]);
    });
  }
});

test.describe("keyboard access and focus visibility", () => {
  test("the primary CTA on the homepage is reachable and shows a visible focus ring", async ({ page }) => {
    await page.goto("/");
    const cta = page.getByRole("link", { name: "Start building" }).first();
    await cta.focus();
    await expect(cta).toBeFocused();

    const { outlineStyle, outlineWidth } = await cta.evaluate((el) => {
      const style = getComputedStyle(el);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    expect(outlineStyle).not.toBe("none");
    expect(outlineWidth).not.toBe("0px");
  });

  test("the graph's pause control is keyboard-accessible and toggles Resume", async ({ page }) => {
    await page.goto("/");
    const hero = page.getByRole("group", { name: "Authority field, animated" });
    // Desktop and mobile layouts each render their own copy of the control, sharing one paused
    // state; `.first()` is the desktop one, visible at this default viewport.
    const pauseButton = hero.getByRole("button", { name: "Pause animation" }).first();
    // Keyboard-accessible even though it's visually subtle until focused — focusing it directly
    // (simulating Tab arriving on it) must work without first needing a pointer hover.
    await pauseButton.focus();
    await expect(pauseButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(hero.getByRole("button", { name: "Resume animation" }).first()).toBeVisible();
  });

  test("kill-switch confirmation is keyboard operable", async ({ page }) => {
    await page.goto("/app/tasks/demo-task");
    const trigger = page.getByRole("button", { name: "Revoke all authority" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alertdialog")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alertdialog")).toBeHidden();
  });

  test("skip link moves focus to dashboard main content", async ({ page }) => {
    await page.goto("/app");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#dashboard-main")).toBeFocused();
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the authority graph renders the resolved state with no pause control", async ({ page }) => {
    await page.goto("/");
    const hero = page.getByRole("group", { name: "Authority field, animated" });
    // Both the desktop and mobile layouts render in the DOM simultaneously (one hidden via CSS
    // depending on viewport width), so this text matches two elements. The desktop layout is
    // first in DOM order and this test runs at the default (desktop-width) viewport, where it's
    // the one actually visible.
    await expect(hero.getByText("Permissions revoked").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Pause animation" })).toHaveCount(0);
  });

  test("the walkthrough is fully usable with motion reduced", async ({ page }) => {
    await page.goto("/demo");
    const walkthrough = page.getByRole("group", { name: "Runtime authorization walkthrough" });
    await walkthrough.getByRole("button", { name: "Next" }).click();
    await expect(walkthrough.getByRole("heading", { name: "Task Authority Contract created" })).toBeVisible();
  });
});

test.describe("mobile drawer at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("every navigation target is reachable by keyboard inside the drawer", async ({ page }) => {
    await page.goto("/app");
    await page.getByRole("button", { name: "Menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Control plane navigation" });

    for (const label of ["Setup", "Overview", "Agents", "Connections", "Activity", "Approvals", "Settings"]) {
      await expect(drawer.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible();
    }

    // Advanced tools are one keyboard-operable toggle away.
    const advanced = drawer.getByRole("button", { name: "Advanced" });
    await advanced.focus();
    await page.keyboard.press("Enter");
    for (const label of ["Applications", "Tasks", "Policies", "Validation Lab"]) {
      await expect(drawer.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
  });
});
