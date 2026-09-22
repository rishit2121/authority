import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Storage state written by auth.setup.ts and reused by the authenticated project. */
const AUTH_STATE = path.join(process.cwd(), "test-results", ".auth", "owner-a.json");

export default defineConfig({
  testDir: "./src/tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    // Signs in once; the authenticated project depends on its output.
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },

    /**
     * No stored session. Covers the marketing surface, the auth forms
     * themselves, and the protected-route redirects — all of which are only
     * meaningful while signed out.
     */
    {
      name: "public",
      testMatch: /(marketing|auth-flows|protected-routes)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: undefined },
    },

    /**
     * Signed in as the tenant A owner. The control-plane suites need a real
     * session now that /app is protected server-side.
     */
    {
      name: "authenticated",
      testMatch: /(dashboard-navigation|kill-switch|accessibility-layout|tenancy)\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE },
    },
  ],
  // Runs against a production build so the e2e suite exercises what ships.
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
