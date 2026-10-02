import { expect, test } from "@playwright/test";

/**
 * Server-side route protection.
 *
 * Banner assertions are scoped to <main>: Next.js appends its own
 * <next-route-announcer role="alert"> to the body.
 *
 * Runs in the `public` project, so there is no stored session. Every one of
 * these assertions would pass trivially against a client-side guard that
 * merely hides content, so each checks the URL the server actually sent the
 * browser to.
 */

const PROTECTED_ROUTES = [
  "/app",
  "/app/tasks",
  "/app/tasks/demo-task",
  "/app/agents",
  "/app/policies",
  "/app/integrations",
  "/app/approvals",
  "/app/settings",
];

test.describe("protected routes", () => {
  for (const route of PROTECTED_ROUTES) {
    test(`${route} redirects an unauthenticated visitor to /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp("/login"));
      await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    });
  }

  test("the return path is preserved so the user lands where they intended", async ({ page }) => {
    await page.goto("/app/tasks/demo-task");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Ftasks%2Fdemo-task/);
  });

  test("no protected content leaks into the redirected response", async ({ page }) => {
    await page.goto("/app/tasks/demo-task");
    // The task investigation view's own headings must be absent entirely, not
    // merely hidden by CSS.
    await expect(page.getByText("Task contract")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Control plane" })).toHaveCount(0);
  });

  test.describe("open redirect resistance", () => {
    const hostile = [
      "//evil.example",
      "https://evil.example/app",
      "/%5Cevil.example",
      "/\\evil.example",
      "javascript:alert(1)",
    ];

    for (const candidate of hostile) {
      test(`a next parameter of ${JSON.stringify(candidate)} is discarded`, async ({ page }) => {
        await page.goto(`/login?next=${encodeURIComponent(candidate)}`);

        // The hostile value must not survive into the form that will be
        // submitted after a successful sign-in.
        const nextField = page.locator('input[name="next"]');
        await expect(nextField).toHaveValue("/app");
      });
    }
  });

  test("sign-out is not reachable by GET", async ({ request }) => {
    // A GET sign-out can be triggered by any third-party page, making session
    // termination a cross-site nuisance.
    const response = await request.get("/auth/sign-out", { maxRedirects: 0 });
    expect(response.status()).toBe(405);
  });

  test("the email callback with no code lands on login rather than erroring", async ({ page }) => {
    await page.goto("/auth/callback");
    await expect(page).toHaveURL(/\/login/);
  });
});
