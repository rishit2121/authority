#!/usr/bin/env node
/**
 * Post-build gate: fails if the gateway credential, the `pg` driver, a
 * gateway function name or the value of any configured secret appears in the
 * browser bundle (`.next/static`). Run after `next build` (npm run verify:bundle).
 * Prints file paths and match labels only, never values.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { scanDirectory, secretValuesFromEnv } from "./lib/bundle-scan.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function loadEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0)
      out[t.slice(0, eq).trim()] = t
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = {
  ...loadEnv(path.join(root, ".env.local")),
  ...loadEnv(path.join(root, ".supabase-cli.env")),
  ...process.env,
};
const distDir = process.env.NEXT_DIST_DIR || ".next";
const dir = path.join(root, distDir, "static");
if (!existsSync(dir)) {
  console.error(
    `No ${distDir}/static found: run \`npm run build\` first (with the same NEXT_DIST_DIR, if set).`,
  );
  process.exit(2);
}

const { scanned, findings } = scanDirectory(dir, secretValuesFromEnv(env));
if (findings.length > 0) {
  console.error(`FAIL: ${findings.length} forbidden match(es) in the browser bundle:`);
  for (const f of findings) console.error(`  ${path.relative(root, f.file)}  [${f.label}]`);
  process.exit(1);
}
console.log(`OK: scanned ${scanned} browser asset(s); no gateway credential, driver or secret value found.`);
