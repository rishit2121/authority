import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SafeFetchInput, SafeFetchResult } from "@/lib/connectors/custom-api/network-guard";
import { runFirstCall, type FetchLike } from "@/lib/setup/first-call";
import { READ_CALLS, setupCustomerExternalId } from "@/lib/setup/state";
import type { Database } from "@/lib/supabase/database.types";

import { FIXTURE_PASSWORD, localSupabaseEnv, OWNER_A } from "./local-env";
import { ADMIN_A_USER_ID, configureLocalEnv, TENANT_A_ID, type Handler } from "./mock-provider-fixture";

/**
 * The Setup page's "Make a protected call" (src/lib/setup/first-call.ts), for real: the same function the server
 * action runs, with its fetch routed to Authority's own route handlers in this process (customers, tasks, prepare,
 * sessions, authorize, execute, session revoke), against a throwaway LOCAL Supabase (local-env.ts refuses anything
 * else).
 *
 * The provider is a MOCK Slack transport injected into the real Slack connector; nothing leaves the machine. It
 * proves: the setup customer without access is refused before any provider request; after one explicit grant the
 * read executes exactly once; the call never changes the connection's access policy; only the chosen connection is
 * bound; and the same attempt id never dispatches twice.
 */

const CONNECTION_PREFIX = "setup-first-call";
const MOCK_BOT_TOKEN = "xoxb-mock-setup-first-call-not-a-real-token";
const BASE = "http://localhost";

class MockSlack {
  requests: string[] = [];
  get listCalls() {
    return this.requests.filter((p) => p === "/api/conversations.list").length;
  }
  fetch = async (input: SafeFetchInput): Promise<SafeFetchResult> => {
    this.requests.push(input.url.pathname);
    const json =
      input.url.pathname === "/api/conversations.list"
        ? {
            ok: true,
            channels: [
              { id: "C0GENERAL", name: "general" },
              { id: "C0ENG", name: "engineering" },
              { id: "C0RANDOM", name: "random" },
            ],
          }
        : input.url.pathname === "/api/auth.test"
          ? { ok: true, team: "Setup (mock)" }
          : { ok: false, error: "unknown_method" };
    return {
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      bodyText: JSON.stringify(json),
      truncated: false,
    };
  };
}

const slack = new MockSlack();
let db: pg.Client;
let owner: SupabaseClient<Database>;
let fetchViaHandlers: FetchLike;
const world = {
  appId: "",
  backendKey: "",
  backendCredentialId: "",
  runtimeKey: "",
  agentCredentialId: "",
  agentId: "",
  connectionId: "",
  externalId: "",
};

/** A fetch that dispatches to the in-process route handlers, like `request()` in mock-provider-fixture.ts. */
async function buildFetch(): Promise<FetchLike> {
  const load = async (path: string) => (await import(path)).POST as unknown as Handler;
  const routes: Array<[RegExp, Handler, (m: RegExpMatchArray) => Record<string, string> | undefined]> = [
    [/^\/api\/v1\/customers$/, await load("@/app/api/v1/customers/route"), () => undefined],
    [
      /^\/api\/v1\/customers\/([^/]+)\/tasks$/,
      await load("@/app/api/v1/customers/[customerId]/tasks/route"),
      (m) => ({ customerId: m[1]! }),
    ],
    [
      /^\/api\/v1\/tasks\/([^/]+)\/prepare$/,
      await load("@/app/api/v1/tasks/[taskId]/prepare/route"),
      (m) => ({ taskId: m[1]! }),
    ],
    [/^\/api\/v1\/sessions$/, await load("@/app/api/v1/sessions/route"), () => undefined],
    [/^\/api\/v1\/sessions\/revoke$/, await load("@/app/api/v1/sessions/revoke/route"), () => undefined],
    [/^\/api\/v1\/authorize$/, await load("@/app/api/v1/authorize/route"), () => undefined],
    [/^\/api\/v1\/execute$/, await load("@/app/api/v1/execute/route"), () => undefined],
  ];
  return async (url, init) => {
    const path = new URL(url).pathname;
    for (const [pattern, handler, params] of routes) {
      const match = path.match(pattern);
      if (!match) continue;
      const req = new NextRequest(url, {
        method: init.method,
        headers: init.headers as Record<string, string>,
        body: init.body as string,
      });
      const p = params(match);
      return handler(req, p ? { params: Promise.resolve(p) } : undefined);
    }
    throw new Error(`no route for ${path}`);
  };
}

async function disconnect(connectionId: string) {
  const { disconnectConnectorConnection } = await import("@/lib/gateway/rpc-connectors");
  const result = await disconnectConnectorConnection({
    tenantId: TENANT_A_ID,
    userId: ADMIN_A_USER_ID,
    connectionId,
  });
  if (result.status !== "ok") throw new Error(`disconnect: ${result.status}`);
}

async function disconnectEarlierTestConnections() {
  const active = await db.query<{ id: string; name: string }>(
    `select id, name from public.connector_connections
      where tenant_id = $1 and connector_id = 'slack' and status <> 'disconnected'`,
    [TENANT_A_ID],
  );
  for (const row of active.rows) {
    if (!row.name.startsWith(CONNECTION_PREFIX)) {
      throw new Error(
        `Tenant A already has an active Slack connection ("${row.name}"). This test will not touch a connection ` +
          "it did not create; disconnect it in the local dashboard or reset the local database.",
      );
    }
    await disconnect(row.id);
  }
}

async function policyRows() {
  const { rows } = await db.query(
    `select id, application_id, connection_id, scope, max_grant_seconds, updated_at
       from public.application_connection_access_policies where connection_id = $1 order by id`,
    [world.connectionId],
  );
  return rows;
}

const run = (attemptId: string) =>
  runFirstCall({
    baseUrl: BASE,
    backendKey: world.backendKey,
    runtimeKey: world.runtimeKey,
    agentId: world.agentId,
    externalId: world.externalId,
    call: READ_CALLS.slack,
    connectionId: world.connectionId,
    attemptId,
    fetch: fetchViaHandlers,
  });

beforeAll(async () => {
  configureLocalEnv();
  delete process.env.SLACK_FIXTURE_MODE;
  const { createSlackConnector, defaultSlackConnectorDeps } =
    await import("@/lib/connectors/slack/connector");
  const { registerConnector, resetConnectorRegistryForTests } = await import("@/lib/connectors/registry");
  resetConnectorRegistryForTests();
  registerConnector(createSlackConnector({ ...defaultSlackConnectorDeps, fetch: slack.fetch }));
  fetchViaHandlers = await buildFetch();

  const env = localSupabaseEnv();
  db = new pg.Client({ connectionString: env.dbUrl });
  await db.connect();
  owner = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } });
  const { error } = await owner.auth.signInWithPassword({ email: OWNER_A, password: FIXTURE_PASSWORD });
  if (error) throw new Error(`sign-in: ${error.message}`);

  const stamp = `${CONNECTION_PREFIX}-${Date.now().toString(36)}`;
  world.externalId = setupCustomerExternalId(`local-test-${stamp}`);
  const { data: app, error: appError } = await owner.rpc("create_application", {
    p_tenant_id: TENANT_A_ID,
    p_name: stamp,
    p_slug: stamp,
    p_environment: "production",
  });
  if (appError || app?.[0]?.app_status !== "ok") throw new Error(`create_application: ${appError?.message}`);
  world.appId = app[0].app_application_id as string;
  const { data: bk } = await owner.rpc("create_backend_credential", {
    p_application_id: world.appId,
    p_name: `Setup: ${stamp}`,
  });
  const { data: principal } = await owner.rpc("ensure_human_principal_for_current_user", {
    p_tenant_id: TENANT_A_ID,
  });
  const { data: agent, error: agentError } = await owner
    .from("agents")
    .insert({
      tenant_id: TENANT_A_ID,
      name: "Setup agent",
      model: "unspecified",
      model_provider: "unspecified",
      framework: "authority-setup",
      owner_principal_id: principal as string,
    })
    .select("id")
    .single();
  if (agentError || !agent) throw new Error(`agent: ${agentError?.message}`);
  const { data: ak } = await owner.rpc("create_agent_credential", { p_agent_id: agent.id });
  world.backendKey = bk![0].plaintext_secret;
  world.backendCredentialId = bk![0].credential_id;
  world.runtimeKey = ak![0].plaintext_secret;
  world.agentCredentialId = ak![0].credential_id;
  world.agentId = agent.id;

  await disconnectEarlierTestConnections();
  const { createConnectorConnection } = await import("@/lib/gateway/rpc-connectors");
  const { setConnectorSecret } = await import("@/lib/gateway/rpc-connector-secrets");
  const created = await createConnectorConnection({
    tenantId: TENANT_A_ID,
    userId: ADMIN_A_USER_ID,
    connectorId: "slack",
    name: stamp,
    environment: "development",
  });
  if (created.status !== "ok" || !created.connectionId)
    throw new Error(`slack connection: ${created.status}`);
  world.connectionId = created.connectionId;
  const secret = await setConnectorSecret({
    tenantId: TENANT_A_ID,
    userId: ADMIN_A_USER_ID,
    connectionId: world.connectionId,
    secretType: "bearer_token",
    plaintextSecret: MOCK_BOT_TOKEN,
  });
  if (secret !== "ok") throw new Error(`slack token: ${secret}`);
}, 120_000);

afterAll(async () => {
  try {
    if (world.connectionId) await disconnect(world.connectionId);
    if (world.backendCredentialId) {
      await owner.rpc("revoke_backend_credential", {
        p_credential_id: world.backendCredentialId,
        p_reason: "setup-first-call local test cleanup",
      });
    }
    if (world.agentCredentialId) {
      await owner.rpc("revoke_agent_credential", {
        p_credential_id: world.agentCredentialId,
        p_reason: "setup-first-call local test cleanup",
      });
    }
  } finally {
    await db?.end();
  }
});

describe("Setup: make a protected call (local, mock Slack)", () => {
  let customerId = "";
  let executedTaskId = "";
  const executedAttempt = randomUUID();

  it("refuses the setup customer without access before anything reaches the provider", async () => {
    const before = await policyRows();
    const result = await run(randomUUID());
    expect(result.outcome, JSON.stringify(result)).toBe("needs_access");
    expect(result.decision).toBeNull();
    expect(result.customerId).toBeTruthy();
    customerId = result.customerId!;
    expect(slack.requests).toEqual([]);
    expect(await policyRows()).toEqual(before);
  });

  it("after one explicit grant to that customer only, list_channels executes exactly once", async () => {
    const before = await policyRows();
    const { data: grant } = await owner.rpc("grant_connection_delegation", {
      p_connection_id: world.connectionId,
      p_customer_id: customerId,
    });
    expect(grant).toBe("ok");

    const result = await run(executedAttempt);
    expect(result.outcome, JSON.stringify(result)).toBe("executed");
    expect(result.decision?.status).toMatch(/^allow/);
    expect(result.receiptId).toBeTruthy();
    expect(result.summaryOfData).toBe("3 channels");
    expect(JSON.stringify(result)).not.toContain("engineering");
    expect(slack.listCalls).toBe(1);
    executedTaskId = result.taskId!;

    // The call changed nobody's access: no policy row was written or altered.
    expect(await policyRows()).toEqual(before);
    expect(before).toEqual([]);
    const delegations = await db.query(
      `select customer_id from public.connection_delegations where connection_id = $1 and revoked_at is null`,
      [world.connectionId],
    );
    expect(delegations.rows.map((r) => r.customer_id)).toEqual([customerId]);
  });

  it("bound only the chosen connection to the task, under the setup idempotency key", async () => {
    const bindings = await db.query(
      `select connector_id, connection_id from public.task_connector_bindings where task_id = $1`,
      [executedTaskId],
    );
    expect(bindings.rows).toEqual([{ connector_id: "slack", connection_id: world.connectionId }]);
    const task = await db.query(`select idempotency_key, customer_id from public.tasks where id = $1`, [
      executedTaskId,
    ]);
    expect(task.rows[0]).toEqual({ idempotency_key: `setup-${executedAttempt}`, customer_id: customerId });
    const receipts = await db.query(
      `select result_category, connection_id from public.connector_execution_receipts where task_id = $1`,
      [executedTaskId],
    );
    expect(receipts.rows).toEqual([{ result_category: "succeeded", connection_id: world.connectionId }]);
  });

  it("the same attempt id never dispatches again", async () => {
    const result = await run(executedAttempt);
    expect(result.taskId).toBe(executedTaskId);
    // Authorize replays the decision without a new capability token, so nothing can be executed again.
    expect(result.outcome, JSON.stringify(result)).toBe("indeterminate");
    expect(result.detail).toMatch(/already authorized/);
    expect(slack.listCalls).toBe(1);
    const receipts = await db.query(
      `select count(*)::int as n from public.connector_execution_receipts where task_id = $1`,
      [executedTaskId],
    );
    expect(receipts.rows[0].n).toBe(1);
  });

  it("never touched any other connector", () => {
    expect(slack.requests.every((p) => p === "/api/conversations.list")).toBe(true);
  });
});
