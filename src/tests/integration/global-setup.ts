import { readFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";

/**
 * vitest's `globalSetup` runs once, before any worker (and before
 * `setupFiles`, which is per-worker) -- `.supabase-cli.env` isn't
 * guaranteed loaded into `process.env` yet at this point even though
 * setup.ts loads it for every test file, so this does the same small,
 * dependency-free parse setup.ts already does, standalone.
 */
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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * Self-healing sweep for two kinds of leaked fixture, run once before the
 * integration suite starts:
 *
 *   1. createGatewayFixture's own rows (gateway-support.ts), identified by
 *      id prefix `dd000000-`. Confirmed this session: `npm run
 *      test:integration` runs its files sequentially (`fileParallelism:
 *      false`), so this is not inter-file contention within one run -- it
 *      reproduces only when something else (pgTAP, Playwright, an ad hoc
 *      script) hits the same shared remote database at the same time,
 *      exhausting managementQuery's own retry budget on a cleanup delete.
 *      70 of 95 leaked tenant-A tasks found this session traced to exactly
 *      that, accumulated across many such overlapping runs.
 *
 *   2. Custom API / Postgres connector fixtures (custom-api-support.ts,
 *      postgres-support.ts), identified by tenant instead of id prefix --
 *      see TEST_TENANT_IDS below. An interrupted run that created a
 *      connection and published an operation/query but never reached its
 *      own cleanup leaves that definition in `status = 'published'`
 *      forever, which is enough to change `buildTenantRegistry()`'s
 *      computed registry version for every later test against that
 *      tenant -- confirmed this session as the actual cause of GitHub
 *      authorize calls failing with UNSUPPORTED_CONTRACT_VERSION, with no
 *      GitHub-specific code at fault at all.
 *
 * Rather than chase either specific race (both are transient, already-
 * retried failures against a database this suite doesn't control the load
 * on), this reclaims anything a PRIOR run left behind before a NEW one
 * starts, so accumulation stays bounded to "this run's own leaks" instead
 * of growing forever. A fixture younger than an hour is left alone -- it
 * could still belong to a run that is genuinely in progress (e.g. this
 * same suite, mid-file, if a worker crashed between files) or to another
 * tool's own run.
 */
const STALE_AFTER = "1 hour";
const FIXTURE_ID_PREFIX = "dd000000-%";

/**
 * The two fixed, seeded test tenants every integration test runs against
 * (supabase/seed.sql; mirrors support.ts's own TENANT_A_ID/TENANT_B_ID,
 * duplicated rather than imported for the same reason loadEnvFile above is
 * standalone -- this file must not pull in anything that assumes a test
 * runner context). Never a real tenant, so sweeping every connector
 * connection these two own -- regardless of which test created it -- is
 * safe in a way the equivalent sweep would not be for any other tenant.
 */
const TEST_TENANT_IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];

export default async function setup(): Promise<void> {
  loadEnvFile(path.join(process.cwd(), ".env.local"));
  loadEnvFile(path.join(process.cwd(), ".supabase-cli.env"));

  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!projectRef || !password) {
    // Same precondition managementQuery itself has; .supabase-cli.env isn't
    // guaranteed loaded yet this early, and this sweep is a best-effort
    // convenience, never something a run should fail over.
    return;
  }

  const client = new pg.Client({
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    user: "postgres",
    password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query(`
      set local role postgres;
      select set_config('authority.allow_demo_purge', 'on', true);

      create temporary table stale_fixture_agents on commit drop as
        select id from public.agents
        where id::text like '${FIXTURE_ID_PREFIX}' and created_at < now() - interval '${STALE_AFTER}';
      -- Every task belonging to a stale fixture agent, not just the ones
      -- whose OWN id also happens to match the fixture prefix: a leaked
      -- agent can be "adopted" by an unrelated later task (confirmed this
      -- session -- a Playwright customer-connections task referenced a
      -- leaked createGatewayFixture agent as "any existing agent for this
      -- tenant"), and deleting the agent first would violate that task's
      -- own foreign key.
      create temporary table stale_fixture_tasks on commit drop as
        select id from public.tasks
        where agent_id in (select id from stale_fixture_agents)
           or (id::text like '${FIXTURE_ID_PREFIX}' and created_at < now() - interval '${STALE_AFTER}');

      delete from public.contract_compilations where task_id in (select id from stale_fixture_tasks);
      delete from public.jev_risk_evaluations where task_id in (select id from stale_fixture_tasks);
      delete from public.jev_necessity_evaluations where task_id in (select id from stale_fixture_tasks);
      delete from public.jev_plan_completeness_evaluations where task_id in (select id from stale_fixture_tasks);
      delete from public.github_execution_receipts where task_id in (select id from stale_fixture_tasks);
      delete from public.connector_execution_receipts where task_id in (select id from stale_fixture_tasks);
      delete from public.connector_reservations where task_id in (select id from stale_fixture_tasks);
      delete from public.capability_reservations where task_id in (select id from stale_fixture_tasks);
      delete from public.task_repository_bindings where task_id in (select id from stale_fixture_tasks);
      delete from public.task_connector_bindings where task_id in (select id from stale_fixture_tasks);
      delete from public.task_sessions where task_id in (select id from stale_fixture_tasks);
      delete from public.runtime_approval_decisions where request_id in (
        select id from public.runtime_approval_requests where task_id in (select id from stale_fixture_tasks)
      );
      delete from public.capability_consumptions where capability_id in (
        select id from public.capability_tokens where task_id in (select id from stale_fixture_tasks)
      );
      delete from public.capability_tokens where task_id in (select id from stale_fixture_tasks);
      delete from public.runtime_approval_requests where task_id in (select id from stale_fixture_tasks);
      delete from public.final_decisions where task_id in (select id from stale_fixture_tasks);
      delete from public.semantic_evaluations where task_id in (select id from stale_fixture_tasks);
      delete from public.semantic_shadow_evaluations where task_id in (select id from stale_fixture_tasks);
      delete from public.execution_events where task_id in (select id from stale_fixture_tasks);
      delete from public.authorization_decisions where task_id in (select id from stale_fixture_tasks);
      delete from public.capabilities where task_id in (select id from stale_fixture_tasks);
      delete from public.tool_requests where task_id in (select id from stale_fixture_tasks);
      delete from public.task_authority_contracts where task_id in (select id from stale_fixture_tasks);
      delete from public.plan_nodes where plan_id in (select id from public.plans where task_id in (select id from stale_fixture_tasks));
      delete from public.plans where task_id in (select id from stale_fixture_tasks);
      delete from public.tasks where id in (select id from stale_fixture_tasks);

      delete from public.agent_auth_events where agent_id in (select id from stale_fixture_agents);
      delete from public.agent_credentials where agent_id in (select id from stale_fixture_agents);
      delete from public.agents where id in (select id from stale_fixture_agents);

      -- Second sweep: Custom API / Postgres connector fixtures
      -- (custom-api-support.ts, postgres-support.ts). Their connections use
      -- randomUUID(), not a recognizable id prefix, so this one keys on
      -- tenant instead -- safe here specifically because TEST_TENANT_IDS
      -- are fixed, seeded, never-real tenants (see the constant's own
      -- comment). A run interrupted between creating a connection/published
      -- operation and its own cleanup (confirmed this session: an
      -- interrupted custom-api and a postgres-query test each left one
      -- published definition behind, which poisoned every later
      -- buildTenantRegistry() call for that tenant with a registry-version
      -- suffix no other test expected) previously accumulated forever.
      create temporary table stale_connector_connections on commit drop as
        select id from public.connector_connections
        where tenant_id = any(array[${TEST_TENANT_IDS.map((id) => `'${id}'::uuid`).join(", ")}])
          and created_at < now() - interval '${STALE_AFTER}';

      delete from public.backend_connection_access_grants where delegation_id in (
        select id from public.connection_delegations where connection_id in (select id from stale_connector_connections)
      );
      delete from public.connection_delegations where connection_id in (select id from stale_connector_connections);
      delete from public.application_connection_access_policies where connection_id in (select id from stale_connector_connections);
      delete from public.connection_sessions where created_connection_id in (select id from stale_connector_connections);
      delete from public.connector_execution_receipts where connection_id in (select id from stale_connector_connections);
      delete from public.connector_reservations where connection_id in (select id from stale_connector_connections);
      delete from public.task_connector_bindings where connector_id in (
        select 'custom_' || replace(id::text, '-', '') from stale_connector_connections
        union all
        select 'postgres_' || replace(id::text, '-', '') from stale_connector_connections
      );
      delete from public.custom_operation_definitions where connection_id in (select id from stale_connector_connections);
      delete from public.postgres_query_definitions where connection_id in (select id from stale_connector_connections);
      delete from public.connector_connection_secrets where connection_id in (select id from stale_connector_connections);
      delete from public.connector_connections where id in (select id from stale_connector_connections);
    `);
  } catch {
    // Best-effort: never fail the suite over a sweep of someone else's
    // leftovers. A genuine, non-transient defect here would surface the same
    // way any other leaked fixture already does -- the next run tries again.
    console.warn("global-setup: could not sweep stale integration-test fixtures (non-fatal)");
  } finally {
    await client.end().catch(() => undefined);
  }
}
