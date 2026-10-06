import { randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import { managementQuery } from "../integration/support";
import { ADMIN_A, OWNER_A, TEST_PASSWORD } from "./support/users";

/**
 * The authentication forms, signed out.
 *
 * Form banners are queried inside <main>. Next.js appends its own
 * <next-route-announcer role="alert"> to the document body for screen-reader
 * route changes, so an unscoped getByRole("alert") matches two elements.
 *
 * Email confirmation is enabled on the development project, so sign-up cannot
 * complete to a session in an automated test. What is asserted instead is the
 * behaviour that matters and is testable: client-side validation (all of
 * which runs before any Supabase call is ever made, so it is fully
 * deterministic) and that a real credential signs in.
 *
 * Enumeration resistance — a new address and an already-registered one must
 * be indistinguishable — is *not* re-verified here against the live
 * project. It used to be, by performing two real sign-up submissions, and
 * that test was flaky in exactly the way live external dependencies are:
 * Supabase's own project-level rate limiting and address-validation
 * heuristics vary with recent traffic this application does not control,
 * occasionally returning a validation error instead of either of the two
 * expected outcomes. The security property itself is unconditional and
 * belongs in required, always-green coverage, so it is now verified
 * deterministically instead, at the layer that actually decides it:
 * `resolveSignUpOutcome()` (src/lib/auth/errors.ts), unit-tested directly in
 * src/tests/unit/auth-errors.test.ts against every one of Supabase's
 * documented response shapes for this endpoint, with no network involved.
 * A live, end-to-end version of the original two-submission comparison
 * still exists for optional, manual, or scheduled verification against the
 * real project — see src/tests/e2e/external/signup-enumeration-live.spec.ts,
 * excluded from this required suite by default.
 *
 * The one step that cannot be automated without an inbox is clicking the
 * emailed confirmation and recovery links. See README for the manual check.
 */

test.describe("login form", () => {
  test("renders the product identity and every required control", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Authority home" })).toBeVisible();
    await expect(page.getByLabel("Work email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Forgot your password?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create one" })).toBeVisible();
    // The security-oriented statement, not a generic marketing line.
    await expect(page.getByText(/never holds standing credentials/i)).toBeVisible();
  });

  test("email and password carry the right autocomplete hints", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Work email")).toHaveAttribute("autocomplete", "email");
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  test("the password can be revealed and re-hidden", async ({ page }) => {
    await page.goto("/login");

    const password = page.getByLabel("Password", { exact: true });
    const toggle = page.getByRole("button", { name: "Show password" });

    await password.fill("a-secret-value");
    await expect(password).toHaveAttribute("type", "password");

    await toggle.click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("is operable by keyboard alone", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Work email").focus();
    await page.keyboard.type(OWNER_A.email);
    await page.keyboard.press("Tab");
    await page.keyboard.type(TEST_PASSWORD);
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/app$/);
  });

  test("rejects invalid credentials without revealing whether the account exists", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(OWNER_A.email);
    await page.getByLabel("Password", { exact: true }).fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/isn't correct/i);

    // Still on the login page, and the message says nothing about existence.
    await expect(page).toHaveURL(/\/login/);
    await expect(alert).not.toContainText(/no account|not registered|does not exist/i);
  });

  test("a nonexistent address produces the identical message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("definitely-not-a-user@authority.test");
    await page.getByLabel("Password", { exact: true }).fill("some-other-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.locator("main").getByRole("alert")).toContainText(/isn't correct/i);
  });

  test("keeps the typed email after a failed attempt", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(OWNER_A.email);
    await page.getByLabel("Password", { exact: true }).fill("wrong");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByLabel("Work email")).toHaveValue(OWNER_A.email);
  });

  test("valid credentials reach the control plane", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(OWNER_A.email);
    await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("navigation", { name: "Control plane" })).toBeVisible();
  });

  test("returns the user to the path they originally requested", async ({ page }) => {
    await page.goto("/app/tasks");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Ftasks/);

    await page.getByLabel("Work email").fill(OWNER_A.email);
    await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/app\/tasks$/);
  });

  test("an authenticated visitor is sent away from /login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(OWNER_A.email);
    await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

    await page.goto("/login");
    await expect(page).toHaveURL(/\/app$/);

    await page.goto("/signup");
    await expect(page).toHaveURL(/\/app$/);
  });

  test("signing out returns to the marketing site and re-protects /app", async ({ page }) => {
    // A dedicated account: ending a session is destructive, and no other spec
    // should depend on the one this test tears down.
    await page.goto("/login");
    await page.getByLabel("Work email").fill(ADMIN_A.email);
    await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

    await page.getByRole("button", { name: new RegExp(ADMIN_A.displayName) }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/$/);

    // The session is genuinely gone, not just visually reset.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("signup form", () => {
  test("renders every required field", async ({ page }) => {
    await page.goto("/signup");

    await expect(page.getByRole("heading", { level: 1, name: /Create your account/i })).toBeVisible();
    await expect(page.getByLabel("Full name")).toBeVisible();
    await expect(page.getByLabel("Work email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Confirm password")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("rejects a password shorter than the minimum", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("Too Short");
    await page.getByLabel("Work email").fill(`short-${Date.now()}@authority.test`);
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm password").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.locator("main").getByRole("alert")).toContainText(/at least 12 characters/i);
  });

  test("rejects mismatched passwords", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("Mismatch Person");
    await page.getByLabel("Work email").fill(`mismatch-${Date.now()}@authority.test`);
    await page.getByLabel("Password", { exact: true }).fill("a-long-enough-password");
    await page.getByLabel("Confirm password").fill("a-different-long-password");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.locator("main").getByRole("alert")).toContainText(/don't match/i);
  });

  test("rejects a malformed email", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("Bad Email");
    await page.getByLabel("Work email").fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("a-long-enough-password");
    await page.getByLabel("Confirm password").fill("a-long-enough-password");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.locator("main").getByRole("alert")).toBeVisible();
  });
});

test.describe("forgot password", () => {
  test("renders the form and links back to sign in", async ({ page }) => {
    await page.goto("/forgot-password");

    await expect(page.getByRole("heading", { level: 1, name: /Reset your password/i })).toBeVisible();
    await expect(page.getByLabel("Work email")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
  });

  test("rejects a malformed address", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Work email").fill("not-an-email");
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page.locator("main").getByRole("alert")).toContainText(/valid email/i);
  });

  // The property that matters is indistinguishability, and it is also the one
  // that holds regardless of Supabase's built-in SMTP send limits: whatever
  // the endpoint says, it must say the same thing for both addresses.
  test("a known and an unknown address produce identical responses", async ({ page }) => {
    const responses: string[] = [];

    for (const address of [OWNER_A.email, `nobody-${Date.now()}@authority.test`]) {
      await page.goto("/forgot-password");
      await page.getByLabel("Work email").fill(address);
      await page.getByRole("button", { name: "Send reset link" }).click();

      const banner = page.locator("main").getByRole("status");
      await expect(banner).toBeVisible();
      responses.push(((await banner.textContent()) ?? "").trim());
    }

    expect(responses[0]).toBe(responses[1]);
    expect(responses[0]).toMatch(/if an account exists/i);
    // Never a statement that mail was definitely sent, or that it was not.
    expect(responses[0]).not.toMatch(/we sent|no account|not registered/i);
  });
});

test.describe("reset password", () => {
  // Reached without a recovery session, which is what a visitor typing the URL
  // or following an expired link sees.
  test("states plainly that the link is invalid rather than showing a dead form", async ({ page }) => {
    await page.goto("/reset-password");

    await expect(page.locator("main").getByRole("alert")).toContainText(/expired or was already used/i);
    await expect(page.getByRole("link", { name: "Request a new link" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Set new password" })).toHaveCount(0);
  });
});

test.describe("mobile authentication pages", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const route of ["/login", "/signup", "/forgot-password", "/reset-password"]) {
    test(`${route} fits the viewport without horizontal overflow`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }

  test("the login form is usable at mobile width", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Work email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});

test.describe("fresh signup reaches a working dashboard", () => {
  // A real signup through /signup cannot reach an authenticated session here
  // (see this file's own module comment: email confirmation is enabled, and
  // there is no inbox to click through). This creates a pre-confirmed user
  // the exact same way supabase/seed.sql creates every other fixture account
  // -- not a shortcut specific to this test -- then drives the REAL /login
  // form and the REAL /app/agents/new page, so this still proves the
  // production onboarding path, not a mocked one. It never writes to
  // tenants/tenant_memberships/principals directly -- those are created by
  // the application itself (ensure_onboarded(), then
  // ensure_human_principal_for_current_user()) the first time this brand-new
  // user reaches /app and /app/agents/new, which is the actual thing this
  // test exists to prove.
  test("a brand-new tenant owner can register their first agent without demo data or manual SQL", async ({
    page,
  }) => {
    const suffix = `${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
    const email = `fresh-signup-${suffix}@authority.test`;
    const password = "Fresh-Signup-Test-2026!";
    const displayName = `Fresh Signup ${suffix}`;

    const rows = (await managementQuery(`
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        is_sso_user, is_anonymous,
        confirmation_token, recovery_token, email_change,
        email_change_token_new, email_change_token_current,
        phone_change, phone_change_token, reauthentication_token
      ) values (
        '00000000-0000-0000-0000-000000000000',
        gen_random_uuid(),
        'authenticated', 'authenticated',
        '${email}',
        extensions.crypt('${password}', extensions.gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('display_name', '${displayName}'),
        false, false,
        '', '', '', '', '', '', '', ''
      )
      returning id;
    `)) as Array<{ id: string }>;
    const userId = rows[0]?.id;
    expect(userId).toBeTruthy();

    try {
      await page.goto("/login");
      await page.getByLabel("Work email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      // Zero memberships so far -- this first request is exactly what
      // triggers ensure_onboarded(), creating this user's own fresh tenant.
      await expect(page).toHaveURL(/\/app$/);

      await page.goto("/app/agents/new");
      const ownerSelect = page.getByLabel("Owner");

      // The actual regression: this used to stay disabled, with "No
      // principals exist yet in this workspace," for every brand-new tenant.
      await expect(page.getByText("No principals exist yet in this workspace.")).toHaveCount(0);
      await expect(ownerSelect).toBeEnabled();
      await expect(ownerSelect).not.toHaveValue("");
      await expect(ownerSelect.locator("option", { hasText: displayName })).toHaveCount(1);

      await page.getByLabel("Name").fill(`fresh-signup-agent-${suffix}`);
      await page.getByLabel("Model", { exact: true }).fill("gpt-4o");
      await page.getByLabel("Model provider").fill("openai");
      await page.getByLabel("Framework").fill("playwright-test");
      await page.getByRole("button", { name: "Register agent" }).click();

      // Redirects to the new agent's own page only on a genuine success.
      await expect(page).toHaveURL(/\/app\/agents\/[0-9a-f-]+$/);
    } finally {
      // Deliberately does NOT delete the tenant, membership, profile or
      // auth.users row this test created: authz.enforce_owner_survives()
      // (20260922000005_membership_guards.sql) makes removing a tenant's
      // last owner membership impossible by design, with no demo-purge
      // escape hatch -- there is no supported way to delete a tenant at
      // all, in this product, for anyone. That's a correct safety
      // invariant, not a gap this test should work around by disabling a
      // trigger on a table every other session shares. The tenant this
      // leaves behind is as harmless as any other fixture tenant already
      // in this database: every query elsewhere scopes by tenant_id, and
      // nothing lists tenants system-wide. Only clean up what COULD leak
      // into another test's assertions -- the agent itself.
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.agent_credentials where agent_id in (
          select a.id from public.agents a
          join public.principals p on p.id = a.owner_principal_id
          where p.user_id = '${userId}'
        );
        delete from public.agents where owner_principal_id in (
          select id from public.principals where user_id = '${userId}'
        );
      `);
    }
  });
});
