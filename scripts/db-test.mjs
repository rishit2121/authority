#!/usr/bin/env node
/**
 * Runs the pgTAP suites in `supabase/tests/` against the linked Supabase
 * project and reports TAP results.
 *
 * Why this exists rather than `supabase test db`: the CLI's own test runner
 * needs the local Docker stack, which is unavailable in this environment (no
 * Docker, and the disk has no room for the images). This runner executes the
 * same SQL against the linked development project over the Management API
 * instead, so the RLS properties are genuinely verified rather than asserted
 * on paper. See README for the Docker path once it is available.
 *
 * Each suite runs inside one transaction that is always rolled back, so the
 * tests never leave rows behind — including the scratch table used to collect
 * TAP output, which the Management API needs because it returns only the final
 * result set of a multi-statement request.
 */

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const testsDir = path.join(root, "supabase", "tests");

/** Reads KEY=value pairs without echoing any value. */
async function loadEnvFile(file) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

// Injected around every suite. Keeps the suite files themselves free of
// harness noise so they read as assertions.
const PRELUDE = `
begin;
set search_path = extensions, public, pg_catalog;

create table public.tap_out (seq bigserial primary key, line text);

-- The suites switch to the \`authenticated\` role to exercise RLS, so that role
-- must be able to record its own results. Scoped to this transaction only.
grant insert, select on public.tap_out to authenticated;
grant usage, select on sequence public.tap_out_seq_seq to authenticated;

create or replace function public.t(p_line text) returns void
language sql as $harness$
  insert into public.tap_out (line) values (p_line);
$harness$;

grant execute on function public.t(text) to authenticated;
`;

const EPILOGUE = `
reset role;
insert into public.tap_out (line) select f.line from finish() as f(line);
select line from public.tap_out order by seq;
rollback;
`;

function parseTap(lines) {
  const results = [];
  for (const chunk of lines) {
    for (const line of String(chunk).split("\n")) {
      const ok = /^ok\s+(\d+)\s*-?\s*(.*)$/.exec(line);
      if (ok) {
        results.push({ passed: true, n: Number(ok[1]), name: ok[2].trim() });
        continue;
      }
      const notOk = /^not ok\s+(\d+)\s*-?\s*(.*)$/.exec(line);
      if (notOk) {
        results.push({ passed: false, n: Number(notOk[1]), name: notOk[2].trim() });
        continue;
      }
      if (line.startsWith("#") && results.length > 0) {
        const last = results[results.length - 1];
        last.diagnostics = [...(last.diagnostics ?? []), line.replace(/^#\s*/, "")];
      }
    }
  }
  return results;
}

async function runSuite({ file, sql, endpoint, token }) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: PRELUDE + sql + EPILOGUE }),
  });

  const body = await response.json();

  if (!response.ok || !Array.isArray(body)) {
    const message = typeof body?.message === "string" ? body.message : JSON.stringify(body).slice(0, 600);
    return { file, error: message, results: [] };
  }

  return { file, results: parseTap(body.map((row) => row.line)) };
}

async function main() {
  const cliEnv = await loadEnvFile(path.join(root, ".supabase-cli.env"));
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? cliEnv.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF ?? cliEnv.SUPABASE_PROJECT_REF;

  if (!token || !ref) {
    console.error(
      "db-test: missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF.\n" +
        "Provide them in .supabase-cli.env or the environment. See .env.example.",
    );
    process.exit(2);
  }

  const endpoint = `https://api.supabase.com/v1/projects/${ref}/database/query`;

  const files = (await readdir(testsDir)).filter((f) => f.endsWith(".sql")).sort();

  if (files.length === 0) {
    console.error(`db-test: no .sql suites found in ${testsDir}`);
    process.exit(2);
  }

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const file of files) {
    const sql = await readFile(path.join(testsDir, file), "utf8");
    const outcome = await runSuite({ file, sql, endpoint, token });

    if (outcome.error) {
      console.log(`\n# ${file}`);
      console.log(`  ERROR: ${outcome.error}`);
      failed += 1;
      failures.push(`${file}: ${outcome.error}`);
      continue;
    }

    console.log(`\n# ${file}`);
    for (const result of outcome.results) {
      if (result.passed) {
        passed += 1;
        console.log(`  ok ${result.n} - ${result.name}`);
      } else {
        failed += 1;
        failures.push(`${file}: ${result.name}`);
        console.log(`  NOT OK ${result.n} - ${result.name}`);
        for (const diagnostic of result.diagnostics ?? []) {
          console.log(`      ${diagnostic}`);
        }
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${files.length} suite(s)`);

  if (failed > 0) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`db-test: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
