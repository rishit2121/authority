import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests that need a throwaway LOCAL Supabase (`supabase start`), never
 * the shared hosted project: they change the pilot gate and owner and sign in
 * as seeded fixture users. Reads API_URL / ANON_KEY / DB_URL from
 * `supabase status -o env` and refuses anything that isn't this machine.
 * Run by CI's `local-supabase` job, or locally: `npm run test:e2e:local`.
 */
const LOCAL = new Set(["127.0.0.1", "localhost"]);
for (const name of ["API_URL", "DB_URL"] as const) {
  const value = process.env[name];
  if (!value || !LOCAL.has(new URL(value).hostname)) {
    throw new Error(`${name} must point at a local Supabase (export \`supabase status -o env\`).`);
  }
}

const PORT = 3200;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./src/tests/e2e-local",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NEXT_DIST_DIR: ".next-local",
      NEXT_PUBLIC_SUPABASE_URL: process.env.API_URL!,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: (process.env.ANON_KEY ?? process.env.PUBLISHABLE_KEY)!,
      GATEWAY_DATABASE_URL:
        process.env.LOCAL_GATEWAY_DATABASE_URL ??
        "postgresql://authority_gateway:ci-only-gateway-password@127.0.0.1:54322/postgres",
      GATEWAY_DATABASE_SSL: "disable",
      AUTHORITY_DEPLOYMENT: "local",
      AUTHORITY_PUBLIC_URL: BASE_URL,
      OPENAI_API_KEY: "",
      OPENROUTER_API_KEY: "",
      RESEND_API_KEY: "",
    },
  },
});
