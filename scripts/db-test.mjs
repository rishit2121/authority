#!/usr/bin/env node
/**
 * Runs the pgTAP suites in `supabase/tests/` against the linked Supabase
 * project and reports TAP results.
 *
 * Why this exists rather than `supabase test db`: the CLI's own test runner
 * needs the local Docker stack, which is unavailable in this environment (no
 * Docker, and the disk has no room for the images). This runner executes the
 * same SQL against the linked development project over a direct Postgres
 * connection instead, so the RLS properties are genuinely verified rather
 * than asserted on paper. See README for the Docker path once it is available.
 *
 * Each suite runs inside one transaction that is always rolled back, so the
 * tests never leave rows behind — including the scratch table used to collect
 * TAP output, which this runner needs because only the final result set of
 * a multi-statement query is used for parsing.
 *
 * Direct connection, not the Management API's `/database/query` endpoint:
 * that endpoint was previously used here, but now rejects any DDL statement
 * with "cannot execute ... in a read-only transaction" (confirmed via a bare
 * `create table` through the same endpoint, and confirmed NOT a property of
 * the database itself — a direct connection with the same credentials allows
 * DDL normally). Since every suite's fixture setup includes at least one
 * `create table`/`create function` for test-only scaffolding, that endpoint
 * can no longer run any suite in this repository. This is an external
 * platform change, not a defect in any suite file.
 */

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

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

// Suites 17 and 18 pin the deterministic engine's semantics through the Part 4
// `public.authorize_tool_call()` signature, which no longer exists in the
// schema. This TEST-ONLY shim (rolled back with each suite) re-creates that
// signature over gateway.commit_authorization(), mapping gateway statuses back
// to the SQLSTATEs the assertions expect. It is never a migration.
const LEGACY_SHIM = `
create function public.authorize_tool_call(
  p_credential_secret text, p_task_id uuid, p_tool text, p_operation text, p_resource text, p_arguments jsonb,
  p_plan_node_id uuid, p_idempotency_key text, p_execution_context jsonb, p_current_registry_version text,
  p_current_compiler_version text
) returns table (
  decision_id uuid, tool_request_id uuid, outcome public.authorization_outcome, reason_codes text[],
  contract_id uuid, contract_version integer, remaining_invocations integer, was_replayed boolean
) language plpgsql security definer set search_path = '' as $shim$
declare
  r record;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  select * into r from gateway.commit_authorization(
    p_credential_secret, p_task_id, p_tool, p_operation, p_resource, p_arguments,
    '{"schemaVersion":1,"count":0,"truncated":false,"entries":[]}'::jsonb, p_plan_node_id, p_idempotency_key,
    p_current_registry_version, p_current_compiler_version, 'low', 1,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    null, null, null, null, null, null, null, null, null, null, null, null, 'test-shim', false);
  if r.r_status in ('invalid_credential', 'revoked_credential') then raise exception 'invalid runtime credential' using errcode = '28000'; end if;
  if r.r_status = 'rate_limited' then raise exception 'rate limited' using errcode = '53400'; end if;
  if r.r_status = 'task_not_found' then raise exception 'task not found' using errcode = 'P0002'; end if;
  if r.r_status = 'agent_mismatch' then raise exception 'agent mismatch' using errcode = '42501'; end if;
  if r.r_status = 'idempotency_conflict' then raise exception 'idempotency conflict' using errcode = '23505'; end if;
  return query select r.r_decision_id, r.r_tool_request_id, r.r_final_outcome, r.r_reason_codes, r.r_contract_id,
    r.r_contract_version, r.r_remaining_invocations, r.r_replayed;
end;
$shim$;
revoke all on function public.authorize_tool_call(text, uuid, text, text, text, jsonb, uuid, text, jsonb, text, text) from public, anon, authenticated;
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

async function runSuite({ client, file, sql }) {
  let result;
  try {
    result = await client.query(PRELUDE + (/^(17|18)_/.test(file) ? LEGACY_SHIM : "") + sql + EPILOGUE);
  } catch (error) {
    // A statement failed outside any `throws_ok`/`lives_ok` assertion (a bug in the suite's own SQL, not
    // something under test). The shared connection is left with an aborted transaction — `begin;` alone does
    // NOT clear that state in Postgres (it only warns "already in progress" and stays aborted), so the next
    // suite would silently fail too. Explicitly rolling back here isolates each suite's failure exactly the
    // way separate Management API requests used to.
    try {
      await client.query("rollback");
    } catch {
      // Nothing to roll back (e.g. the failure happened before `begin;` ran) — ignore.
    }
    return { file, error: error instanceof Error ? error.message : String(error), results: [] };
  }
  // `client.query()` returns one result per statement for a multi-statement string; the one we want is the
  // EPILOGUE's `select line from tap_out order by seq;` — SECOND to last, since EPILOGUE's own last statement
  // is `rollback;`, whose own (empty) result would otherwise be picked up instead.
  const rows = Array.isArray(result) ? (result.at(-2)?.rows ?? []) : (result.rows ?? []);
  return { file, results: parseTap(rows.map((row) => row.line)) };
}

async function main() {
  const cliEnv = await loadEnvFile(path.join(root, ".supabase-cli.env"));
  const ref = process.env.SUPABASE_PROJECT_REF ?? cliEnv.SUPABASE_PROJECT_REF;
  const password = process.env.SUPABASE_DB_PASSWORD ?? cliEnv.SUPABASE_DB_PASSWORD;

  if (!ref || !password) {
    console.error(
      "db-test: missing SUPABASE_PROJECT_REF or SUPABASE_DB_PASSWORD.\n" +
        "Provide them in .supabase-cli.env or the environment. See .env.example.",
    );
    process.exit(2);
  }

  const files = (await readdir(testsDir)).filter((f) => f.endsWith(".sql")).sort();

  if (files.length === 0) {
    console.error(`db-test: no .sql suites found in ${testsDir}`);
    process.exit(2);
  }

  const client = new pg.Client({
    host: `db.${ref}.supabase.co`,
    port: 5432,
    user: "postgres",
    password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  let passed = 0;
  let failed = 0;
  const failures = [];

  try {
    for (const file of files) {
      const sql = await readFile(path.join(testsDir, file), "utf8");
      const outcome = await runSuite({ client, file, sql });

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
  } finally {
    await client.end();
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
