/**
 * Test-time stand-in for the `server-only` package.
 *
 * `server-only`'s real module unconditionally throws — it relies entirely on
 * Next.js's webpack config swapping in a no-op for server bundles and the
 * throwing module only for client bundles. Vitest never runs through that
 * bundler distinction at all, so importing the real package here would throw
 * on every test run regardless of environment. Aliased in vitest.config.mts
 * and vitest.integration.config.mts; this file intentionally does nothing.
 */
export {};
