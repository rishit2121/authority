import path from "node:path";

import { test as setup } from "@playwright/test";

import { signIn } from "./support/auth";
import { OWNER_A } from "./support/users";

/**
 * Signs in once and saves the storage state for the `authenticated` project.
 *
 * Running the real login form here rather than forging a cookie means the
 * whole authenticated suite depends on sign-in genuinely working — if login
 * breaks, this fails loudly instead of the dashboard tests failing obscurely.
 */
export const AUTH_STATE_PATH = path.join(process.cwd(), "test-results", ".auth", "owner-a.json");

setup("authenticate as the tenant A owner", async ({ page }) => {
  await signIn(page, OWNER_A);
  await page.context().storageState({ path: AUTH_STATE_PATH });
});
