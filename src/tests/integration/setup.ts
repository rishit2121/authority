/**
 * Loads `.env.local` into `process.env` for the integration suite.
 *
 * Next.js does this automatically for its own dev/build process; a
 * standalone Vitest run has no equivalent, so this setup file does the same
 * small job `scripts/db-test.mjs` already does for `.supabase-cli.env` —
 * kept dependency-free rather than adding `dotenv` for one file.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

function loadEnvFile(file: string): void {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    // Never override a value already set in the environment (e.g. by CI).
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));
// Needed by managementQuery() in support.ts, which some repository tests
// use for privileged setup/teardown that no RLS-scoped client can perform
// (e.g. temporarily flipping a capability's status). Never logged.
loadEnvFile(path.join(process.cwd(), ".supabase-cli.env"));
