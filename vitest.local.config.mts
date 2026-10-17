import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Tests that need a throwaway LOCAL Supabase (`supabase start`), never the
 * shared hosted project: they change global settings (the pilot gate and
 * owner) and sign in as seeded fixture users through the real API.
 * src/tests/local/local-env.ts refuses any non-local target. Run in CI by
 * the `local-supabase` job; locally: `supabase start`, then
 * `eval "$(supabase status -o env)"` and `npm run test:local`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/tests/support/empty-server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/tests/local/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
