import "server-only";

/**
 * A single, reserved hostname that stands in for the real Slack API during
 * local development and the e2e suite -- the Slack analog of
 * ../stripe/fixture-mode.ts and ../custom-api/fixture-mode.ts. Slack's real
 * API host (`slack.com`) is a fixed constant this connector itself chooses,
 * not tenant-configurable input, so there is no SSRF surface to guard here.
 */
export const SLACK_FIXTURE_HOSTNAME = "slack-fixture.authority.test";

/**
 * Double-gated exactly like every other connector's fixture mode:
 * `SLACK_FIXTURE_MODE=1` opts in, and in production an explicit second flag
 * is also required.
 */
export function slackFixtureModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SLACK_FIXTURE_MODE !== "1") return false;
  if (env.NODE_ENV === "production" && env.AUTHORITY_ALLOW_SLACK_FIXTURE !== "1") return false;
  return true;
}
