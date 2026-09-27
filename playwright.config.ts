import { readFileSync } from "node:fs";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Loads `.supabase-cli.env` into `process.env` for the test-runner process
 * itself — needed by kill-switch.spec.ts, which resets and reinstalls demo
 * data via the Management API after mutating the shared fixture task. Same
 * small loader `scripts/db-test.mjs` and the integration suite's setup file
 * already use; kept dependency-free rather than adding `dotenv`.
 */
function loadEnvFile(file: string): void {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".supabase-cli.env"));

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Storage state written by auth.setup.ts and reused by the authenticated project. */
const AUTH_STATE = path.join(process.cwd(), "test-results", ".auth", "owner-a.json");

/**
 * Optional external-integration project, included only when explicitly
 * requested (`RUN_EXTERNAL_TESTS=1`). Its tests depend on the live linked
 * Supabase project's real email delivery and rate-limit state, which this
 * application does not control — they must never be part of a required,
 * always-green CI run. Omitted from `projects` entirely by default, rather
 * than included-but-skipped: a skipped test still reports a result for a
 * check that never actually ran, which is the outcome this is avoiding.
 */
const externalProjects = process.env.RUN_EXTERNAL_TESTS
  ? [
      {
        name: "external-optional",
        testMatch: /e2e\/external\/.*\.spec\.ts/,
        use: { ...devices["Desktop Chrome"], storageState: undefined },
      },
    ]
  : [];

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
      testMatch:
        /(dashboard-navigation|kill-switch|accessibility-layout|tenancy|product-data|contract-lifecycle|contract-activation|runtime-authorization|semantic-shadow|gateway|validation-lab)\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE },
    },

    /**
     * The GitHub connector suite changes tenant-wide state (installation, repository allowlist,
     * approval policy) and, by design, runtime approvals go stale when tenant policy changes — so it
     * must not overlap with specs that also edit tenant settings. It runs after the authenticated project.
     */
    {
      name: "github",
      testMatch: /github-connector\.spec\.ts/,
      dependencies: ["setup", "authenticated"],
      use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE },
    },

    ...externalProjects,
  ],
  // Runs against a production build so the e2e suite exercises what ships.
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // The MOCK GitHub connector, for the e2e suite only. No real GitHub credential is involved,
      // and the mock refuses to run in production unless explicitly allowed here.
      GITHUB_EXECUTION_MODE: "mock",
      AUTHORITY_ALLOW_MOCK_GITHUB: "1",
      AUTHORITY_PUBLIC_URL: BASE_URL,
      // `next start` here is a local production build against the dev project, without the pooler CA.
      AUTHORITY_DEPLOYMENT: "local",
    },
  },
});
