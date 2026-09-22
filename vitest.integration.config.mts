import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Repository tests that exercise the real linked Supabase project — a real
 * network round trip, a real authenticated session, real RLS. Deliberately
 * separate from `vitest.config.mts`: `npm run test` stays fast and
 * deterministic (Part 1's own stated goal for the unit suite), and this
 * suite only runs on demand via `npm run test:integration`, the same way
 * `npm run db:test` and Playwright are already their own commands rather
 * than folded into the default one.
 *
 * Needs `.env.local` (NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY) and the
 * seeded users from `supabase/seed.sql` to exist on the linked project.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./src/tests/integration/setup.ts"],
    include: ["src/tests/integration/**/*.test.ts"],
    // Real network calls; a tight default timeout would make this flaky
    // rather than meaningfully faster.
    testTimeout: 20_000,
    // One worker: several suites sign in as the same seeded users and
    // mutate shared per-tenant state (e.g. installing/resetting demo data),
    // which parallel workers would race.
    fileParallelism: false,
  },
});
