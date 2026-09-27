import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * OPT-IN live GitHub smoke test. Never part of `npm test`, `npm run test:integration` or CI:
 * it talks to the real api.github.com with a real GitHub App and writes to ONE explicitly
 * named test repository. See docs/github/LIVE_SMOKE_TEST.md.
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
    include: ["src/tests/live/**/*.smoke.test.ts"],
    testTimeout: 120_000,
    fileParallelism: false,
  },
});
