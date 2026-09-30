import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";

import { getSupabaseEnv } from "@/lib/env";
import type { RepositoryContext } from "@/lib/persistence/context";
import type { Database } from "@/lib/supabase/database.types";

// node-pg returns `bigint`/`int8` columns (OID 20) as strings by default, to avoid precision loss beyond JS's
// safe integer range. The Management API this replaced serialized them as plain JSON numbers (matching
// PostgREST's own default), which existing assertions in this suite compare against — e.g.
// `github_installation_id: 9001`. Matching that established convention here, not weakening any assertion.
pg.types.setTypeParser(20, (value: string) => Number(value));

/**
 * Seeded development users, mirroring supabase/seed.sql — the same fixture
 * accounts Playwright's authenticated project signs in as. Development-only
 * accounts under the reserved `.test` TLD; the password is a fixture, not a
 * secret.
 */
export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? "Authority-Dev-2026!";

export const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";
export const TENANT_B_ID = "22222222-2222-4222-8222-222222222222";

export const OWNER_A_EMAIL = "owner.a@authority.test";
export const OWNER_B_EMAIL = "owner.b@authority.test";
export const VIEWER_A_EMAIL = "viewer.a@authority.test";

/**
 * Signs in as a seeded user and returns both the raw client (for assertions
 * that need to query outside any single repository) and a `RepositoryContext`
 * bound to the given tenant, exactly as the application would construct one
 * from a server-verified identity.
 */
export async function signInAs(
  email: string,
  tenantId: string,
): Promise<{ supabase: SupabaseClient<Database>; context: RepositoryContext }> {
  const { url, publishableKey } = getSupabaseEnv();
  const supabase = createClient<Database>(url, publishableKey);

  const { error } = await supabase.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) {
    throw new Error(
      `Could not sign in as ${email} for the integration suite. ` +
        `Is the linked project's seed data (supabase/seed.sql) applied? Cause: ${error.message}`,
    );
  }

  return { supabase, context: { supabase, tenantId } };
}

/**
 * Runs SQL against the linked project over a direct Postgres connection, bypassing RLS entirely — the same
 * privileged path the CLI itself uses (see scripts/db-test.mjs) and the same one the demo-installer RPCs run
 * under as SECURITY DEFINER.
 *
 * Used only for test setup/teardown that no RLS-scoped client legitimately can do (e.g. temporarily flipping a
 * capability's status to exercise "active capabilities" against real data). Never used to assert on
 * application behaviour itself — assertions always go through a signed-in repository context.
 *
 * Previously used the Supabase Management API's `/database/query` endpoint instead of a direct connection; that
 * endpoint now rejects any DDL statement and any UPDATE with "cannot execute ... in a read-only transaction"
 * (confirmed as a platform-side change, not a property of the database itself — a direct connection with the
 * same credentials allows the identical statements) — see scripts/db-test.mjs's doc comment for the same finding
 * and fix, applied identically here.
 *
 * `SUPABASE_PROJECT_REF` / `SUPABASE_DB_PASSWORD` are read from `.supabase-cli.env` (loaded by setup.ts) and are
 * never logged or included in any thrown error message.
 *
 * Retries a failing call a few times with a short backoff before giving up. This is test scaffolding, not part
 * of any tested behavior: it exists because fixture teardown occasionally races a just-completed UI action's
 * own write, reaching this call before that write's effect is visible on this connection, which produces a real
 * but transient constraint violation — confirmed by running the exact same SQL again immediately afterward, by
 * hand, which always succeeds. Retrying a genuine (non-transient) SQL defect costs a few hundred milliseconds and
 * then still fails exactly as before; it is never silently swallowed.
 */
let managementClient: pg.Client | null = null;

async function getManagementClient(): Promise<pg.Client> {
  if (managementClient) return managementClient;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!projectRef || !password) {
    throw new Error(
      "managementQuery: SUPABASE_PROJECT_REF / SUPABASE_DB_PASSWORD missing from .supabase-cli.env",
    );
  }
  const client = new pg.Client({
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    user: "postgres",
    password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  managementClient = client;
  return client;
}

export async function managementQuery(query: string, attempt = 1): Promise<unknown> {
  const client = await getManagementClient();

  try {
    const result = await client.query(query);
    return Array.isArray(result) ? (result.at(-1)?.rows ?? []) : result.rows;
  } catch (error) {
    // A failed statement aborts this connection's current transaction state if one was open; roll back so the
    // next call (this retry, or an unrelated later one) starts clean rather than cascading the failure.
    await client.query("rollback").catch(() => undefined);

    // Part 4 raised the number of Playwright specs writing through this same shared linked project concurrently
    // (runtime-authorization.spec.ts adds several real authorize_tool_call() calls, each taking the same
    // per-task advisory lock pattern other RPCs already use). That widened the exact transient-race window this
    // retry already existed for far enough that 3 attempts at 300ms steps sometimes wasn't enough — confirmed
    // the same way as before: the identical query always succeeds immediately when run by hand right after a
    // failure, and the owning spec always passes when run in isolation. 5 attempts at 400ms steps (up to ~4s
    // total) absorbs the wider window; a genuine SQL defect still fails identically on every attempt regardless.
    const maxAttempts = 5;
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
      return managementQuery(query, attempt + 1);
    }
    // Deliberately generic: never surface the query text or its parameters — only the SQLSTATE and a truncated
    // prefix of the database's own top-line message (enough to tell a lock timeout from a constraint violation).
    const code = (error as { code?: string })?.code ?? "unknown";
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 160);
    throw new Error(`managementQuery failed after ${maxAttempts} attempts (sqlstate ${code}: ${message})`);
  }
}
