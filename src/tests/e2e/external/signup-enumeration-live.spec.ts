import { expect, test } from "@playwright/test";

import { OWNER_A } from "../support/users";

/**
 * OPTIONAL EXTERNAL-INTEGRATION SUITE — not part of required CI.
 *
 * This performs two real sign-up submissions against the live linked
 * Supabase project's actual auth backend (real email-send attempts, real
 * rate-limit accounting) to confirm end-to-end that a brand-new address and
 * an already-registered one are genuinely indistinguishable in production,
 * not merely in the deterministic unit test that exercises the same
 * decision logic (`resolveSignUpOutcome`, see
 * src/tests/unit/auth-errors.test.ts).
 *
 * It is excluded from `npx playwright test` by default: no project in
 * playwright.config.ts matches files under `e2e/external/` unless
 * `RUN_EXTERNAL_TESTS=1` is set. This is deliberate, not an oversight —
 * `signUpAction` calls the real Supabase Auth API for real, so this test's
 * pass/fail depends on the live project's SMTP send quota and rate-limit
 * state at the moment it runs, neither of which this application controls
 * or should be judged against in required CI. Do not add this file to any
 * project's `testMatch` that runs by default, and do not report it as
 * "skipped" in a required run — it should simply not appear.
 *
 * To run it deliberately:
 *   RUN_EXTERNAL_TESTS=1 npx playwright test --project=external-optional
 */
test.describe("signup enumeration resistance (live Supabase)", () => {
  test("a new and an existing address produce identical responses", async ({ page }) => {
    const responses: string[] = [];

    for (const address of [`fresh-${Date.now()}@authority.test`, OWNER_A.email]) {
      await page.goto("/signup");
      await page.getByLabel("Full name").fill("Enumeration Probe");
      await page.getByLabel("Work email").fill(address);
      await page.getByLabel("Password", { exact: true }).fill("a-perfectly-fine-password");
      await page.getByLabel("Confirm password").fill("a-perfectly-fine-password");
      await page.getByRole("button", { name: "Create account" }).click();

      const banner = page.locator("main").getByRole("status").or(page.locator("main").getByRole("alert"));
      await expect(banner.first()).toBeVisible();
      responses.push(((await banner.first().textContent()) ?? "").trim());
    }

    expect(responses[0]).toBe(responses[1]);
    expect(responses[0]).not.toMatch(/already registered|already exists|already taken/i);
  });
});
