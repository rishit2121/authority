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

async function runSuite({ file, sql, endpoint, token }) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: PRELUDE + (/^(17|18)_/.test(file) ? LEGACY_SHIM : "") + sql + EPILOGUE }),
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
