import { expect, type Page } from "@playwright/test";

import { TEST_PASSWORD, type SeededUser } from "./users";

/**
 * Signs in through the real login form.
 *
 * Deliberately not a cookie-injection shortcut: driving the actual form means
 * the authenticated suite also proves the login flow keeps working, and no
 * test holds a hand-built session that the application would have rejected.
 */
export async function signIn(page: Page, user: SeededUser, options: { next?: string } = {}) {
  const target = options.next ? `/login?next=${encodeURIComponent(options.next)}` : "/login";

  await page.goto(target);
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(new RegExp(escapeForRegExp(options.next ?? "/app")));
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: /Account menu|Ada Owner|Vera Viewer|Bo Owner/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
