import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // server-only's real module throws unconditionally — it depends on
      // Next's webpack config to swap in a no-op for server bundles, which
      // Vitest never does. See src/tests/support/empty-server-only.ts.
      "server-only": fileURLToPath(new URL("./src/tests/support/empty-server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    // Playwright owns src/tests/e2e; Vitest must not try to run those.
    include: ["src/tests/unit/**/*.test.{ts,tsx}"],
  },
});
