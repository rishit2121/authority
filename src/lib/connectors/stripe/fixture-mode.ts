import "server-only";

/**
 * A single, reserved hostname that stands in for the real Stripe API during
 * local development and the e2e suite -- the Stripe analog of Custom API's
 * `CUSTOM_API_FIXTURE_HOSTNAME` (see ../custom-api/fixture-mode.ts) and
 * GitHub's `GITHUB_EXECUTION_MODE=mock`. Stripe's real API host
 * (`api.stripe.com`) is a fixed constant this connector itself chooses, not
 * tenant-configurable input, so there is no SSRF surface to guard here the
 * way Custom API's tenant-supplied base URL needs -- this flag only ever
 * substitutes a response for one hostname nothing on the public internet
 * resolves to; it never changes what a real deployment can reach.
 */
export const STRIPE_FIXTURE_HOSTNAME = "stripe-fixture.authority.test";

/**
 * Double-gated exactly like Custom API's and GitHub's own mock modes:
 * `STRIPE_FIXTURE_MODE=1` opts in, and in production an explicit second flag
 * is also required, so a misconfigured production deployment can never end
 * up running the fixture path merely because one environment variable was
 * set by mistake.
 */
export function stripeFixtureModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.STRIPE_FIXTURE_MODE !== "1") return false;
  if (env.NODE_ENV === "production" && env.AUTHORITY_ALLOW_STRIPE_FIXTURE !== "1") return false;
  return true;
}
