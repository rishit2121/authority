import "server-only";

/**
 * A single, reserved hostname that stands in for a real third-party API
 * during local development and the e2e suite -- the Custom API analog of
 * GitHub's `GITHUB_EXECUTION_MODE=mock`. Exactly one hostname is special-
 * cased (see fixture-server.ts); every other tenant-configured base URL,
 * fixture mode on or off, always goes through the real `safeFetch` with its
 * full SSRF/DNS-rebinding guard untouched. This can never widen what a real
 * deployment's Custom API connections can reach -- it only ever substitutes
 * a response for the one hostname nothing on the public internet actually
 * resolves to.
 */
export const CUSTOM_API_FIXTURE_HOSTNAME = "custom-api-fixture.authority.test";

/**
 * Double-gated exactly like GitHub's mock mode (src/lib/github/config.ts):
 * `CUSTOM_API_FIXTURE_MODE=1` opts in, and in production an explicit second
 * flag is also required, so a misconfigured production deployment can never
 * end up running the fixture path merely because one environment variable
 * was set by mistake.
 */
export function customApiFixtureModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CUSTOM_API_FIXTURE_MODE !== "1") return false;
  if (env.NODE_ENV === "production" && env.AUTHORITY_ALLOW_CUSTOM_API_FIXTURE !== "1") return false;
  return true;
}
