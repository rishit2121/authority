/**
 * The commands the site, README, docs and generated snippets show. One definition, so they cannot drift apart.
 * Each is exercised by the CLI's own tests (src/tests/unit/cli) or the local runner; nothing here is aspirational.
 * The CLI is repo-local (scripts/authority-cli.ts, `npm run authority -- <command>`); no package is published.
 */

export const REPO_URL = "https://github.com/rishit2121/authority";

/** Run the Proof Run against a disposable local Supabase and a mock Slack transport. Needs Node 22 and Docker. */
export const DEMO_COMMANDS = [
  `git clone ${REPO_URL}.git`,
  "cd authority && npm ci",
  "npx supabase start",
  "npm run authority -- demo",
] as const;

/** Re-run the same recipe as a regression test: fails if an expected block becomes an allow or a dispatch appears. */
export const REGRESSION_COMMAND =
  "npm run authority -- demo --recipe examples/proof-run/engineering-update.json";

/** Generate a runnable starter (a preview first; nothing is overwritten without --write). */
export const INIT_COMMAND = "npm run authority -- init --dir ../my-agent";

/** Read-only diagnostics: prerequisites, gateway reachability, schema version, credential type. */
export const DOCTOR_COMMAND = "npm run authority -- doctor";
