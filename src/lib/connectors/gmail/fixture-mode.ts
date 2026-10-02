import "server-only";

/**
 * A single, reserved hostname that stands in for BOTH Google's OAuth token
 * endpoint and the Gmail API during local development and the e2e suite --
 * the Gmail analog of ../stripe/fixture-mode.ts. Unlike Stripe/Slack, Gmail
 * needs two upstream hosts (oauth2.googleapis.com and gmail.googleapis.com);
 * fixture mode reroutes both to this one hostname, distinguished by path
 * (see fixture-server.ts).
 */
export const GMAIL_FIXTURE_HOSTNAME = "gmail-fixture.authority.test";

/** Double-gated exactly like every other connector's fixture mode. */
export function gmailFixtureModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.GMAIL_FIXTURE_MODE !== "1") return false;
  if (env.NODE_ENV === "production" && env.AUTHORITY_ALLOW_GMAIL_FIXTURE !== "1") return false;
  return true;
}
