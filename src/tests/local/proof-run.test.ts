import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SafeFetchInput, SafeFetchResult } from "@/lib/connectors/custom-api/network-guard";
import { recipeHash } from "@/lib/proof-run/hash";
import {
  proofRunRecipeSchema,
  taskRunsFor,
  type ProofRunAttempt,
  type ProofRunRecipe,
  type ProofRunResult,
  type ProofRunTranscript,
  type ProofRunTranscriptAttempt,
} from "@/lib/proof-run/recipe";
import type { Database } from "@/lib/supabase/database.types";

import { FIXTURE_PASSWORD, localSupabaseEnv, OWNER_A } from "./local-env";
import {
  ADMIN_A_USER_ID,
  configureLocalEnv,
  loadRoutes,
  request,
  TENANT_A_ID,
  type Handler,
} from "./mock-provider-fixture";

/**
 * The Proof Run, for real: one checked-in recipe (PROOF_RUN_RECIPE, default examples/proof-run/engineering-update.json)
 * run through Authority's own API route handlers -- task creation, prepare, a task session, authorize, execute --
 * against a throwaway LOCAL Supabase (local-env.ts refuses anything else).
 *
 * The provider is a MOCK Slack transport injected into the real Slack connector (and a mock Gmail transport that must
 * never be reached). Nothing leaves the machine and production egress protection is untouched: the mock replaces the
 * connector's fetch in this test process only. Authority alone decides every attempt; this file only compares what
 * happened with the recipe's `expect` and counts requests that reached the mock provider.
 *
 * It fails when an expected block becomes an allow, when a reason changes, or when any provider dispatch appears that
 * the recipe does not expect. With PROOF_RUN_CAPTURE=1 it also writes the sanitized transcript the site plays back
 * (examples/proof-run/captured-run.json). Run it with `npm run authority -- demo`.
 */

const RECIPE_PATH = resolve(process.env.PROOF_RUN_RECIPE ?? "examples/proof-run/engineering-update.json");
const CAPTURE_PATH = resolve("examples/proof-run/captured-run.json");
const recipe: ProofRunRecipe = proofRunRecipeSchema.parse(JSON.parse(readFileSync(RECIPE_PATH, "utf8")));
const MOCK_BOT_TOKEN = "xoxb-mock-proof-run-not-a-real-token";
const CONNECTION_NAME_PREFIX = "proof-run";

/** The mock Slack Web API. Counts every request; only chat.postMessage is a dispatch (a provider write). */
class MockSlack {
  requests: Array<{ path: string; body: Record<string, unknown> | null }> = [];
  get dispatches() {
    return this.requests.filter((r) => r.path === "/api/chat.postMessage").length;
  }
  fetch = async (input: SafeFetchInput): Promise<SafeFetchResult> => {
    const body = input.body ? (JSON.parse(String(input.body)) as Record<string, unknown>) : null;
    this.requests.push({ path: input.url.pathname, body });
    const json =
      input.url.pathname === "/api/chat.postMessage"
        ? { ok: true, channel: body?.channel, ts: `1700000000.${String(this.dispatches).padStart(6, "0")}` }
        : input.url.pathname === "/api/auth.test"
          ? { ok: true, team: "Proof Run (mock)" }
          : { ok: false, error: "unknown_method" };
    return {
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      bodyText: JSON.stringify(json),
      truncated: false,
    };
  };
}

/** A Gmail transport that records and refuses: the recipe never allows email, so any request here is a failure. */
class RefusingGmail {
  requests = 0;
  fetch = async (): Promise<SafeFetchResult> => {
    this.requests += 1;
    throw new Error("The Proof Run must never reach Gmail.");
  };
}

const slack = new MockSlack();
const gmail = new RefusingGmail();
let routes: Awaited<ReturnType<typeof loadRoutes>>;
let db: pg.Client;
let owner: SupabaseClient<Database>;
const world = { backendKey: "", runtimeKey: "", agentId: "", customerId: "", connectionId: "" };
const transcript: ProofRunTranscriptAttempt[] = [];

const call = (
  handler: Handler,
  path: string,
  token: string,
  body: unknown,
  params?: Record<string, string>,
) => request(handler, path, token, body, params);

async function disconnectEarlierProofRunConnections() {
  const { disconnectConnectorConnection } = await import("@/lib/gateway/rpc-connectors");
  const active = await db.query<{ id: string; name: string }>(
    `select id, name from public.connector_connections
      where tenant_id = $1 and connector_id = 'slack' and status <> 'disconnected'`,
    [TENANT_A_ID],
  );
  for (const row of active.rows) {
    if (!row.name.startsWith(CONNECTION_NAME_PREFIX)) {
      throw new Error(
        `Tenant A already has an active Slack connection ("${row.name}"). The Proof Run will not touch a ` +
          "connection it did not create; disconnect it in the local dashboard or reset the local database.",
      );
    }
    const result = await disconnectConnectorConnection({
      tenantId: TENANT_A_ID,
      userId: ADMIN_A_USER_ID,
      connectionId: row.id,
    });
    if (result.status !== "ok") throw new Error(`disconnect earlier proof-run connection: ${result.status}`);
  }
}

async function setUp() {
  const env = localSupabaseEnv();
  db = new pg.Client({ connectionString: env.dbUrl });
  await db.connect();
  owner = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } });
  const { error } = await owner.auth.signInWithPassword({ email: OWNER_A, password: FIXTURE_PASSWORD });
  if (error) throw new Error(`sign-in: ${error.message}`);

  const stamp = `${CONNECTION_NAME_PREFIX}-${Date.now().toString(36)}`;
  const { data: app, error: appError } = await owner.rpc("create_application", {
    p_tenant_id: TENANT_A_ID,
    p_name: stamp,
    p_slug: stamp,
    p_environment: "production",
  });
  if (appError || app?.[0]?.app_status !== "ok") throw new Error(`create_application: ${appError?.message}`);
  const appId = app[0].app_application_id as string;
  await owner.rpc("set_application_require_task_sessions", { p_application_id: appId, p_required: true });
  const { data: bk } = await owner.rpc("create_backend_credential", {
    p_application_id: appId,
    p_name: stamp,
  });
  const { data: principal } = await owner.rpc("ensure_human_principal_for_current_user", {
    p_tenant_id: TENANT_A_ID,
  });
  const { data: agent, error: agentError } = await owner
    .from("agents")
    .insert({
      tenant_id: TENANT_A_ID,
      name: stamp,
      model: "none",
      model_provider: "none",
      framework: "proof-run",
      owner_principal_id: principal as string,
    })
    .select("id")
    .single();
  if (agentError || !agent) throw new Error(`agent: ${agentError?.message}`);
  const { data: ak } = await owner.rpc("create_agent_credential", { p_agent_id: agent.id });
  world.backendKey = bk![0].plaintext_secret as string;
  world.runtimeKey = ak![0].plaintext_secret as string;
  world.agentId = agent.id;

  // A Slack workspace-bot connection (mock token), shared with exactly one customer by an explicit admin grant.
  await disconnectEarlierProofRunConnections();
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

  const customer = await call(routes.customers, "/api/v1/customers", world.backendKey, {
    externalId: `${stamp}-user`,
  });
  world.customerId = customer.body.customerId as string;
  const { data: grant } = await owner.rpc("grant_connection_delegation", {
    p_connection_id: world.connectionId,
    p_customer_id: world.customerId,
  });
  if (grant !== "ok") throw new Error(`grant_connection_delegation: ${grant}`);
}

let taskSeq = 0;
async function openTask() {
  const created = await call(
    routes.tasks,
    `/api/v1/customers/${world.customerId}/tasks`,
    world.backendKey,
    {
      agentId: world.agentId,
      intent: recipe.request,
      connections: [{ connectorId: recipe.connection.connector, connectionId: world.connectionId }],
      idempotencyKey: `proof-run-task-${Date.now()}-${++taskSeq}`,
    },
    { customerId: world.customerId },
  );
  if (created.http !== 201) throw new Error(`task: ${created.http} ${JSON.stringify(created.body)}`);
  const taskId = created.body.taskId as string;
  const nodes = recipe.plan.map((node, sequence) => ({
    id: node.id,
    sequence,
    tool: node.tool,
    arguments: node.arguments,
    agentGenerated: node.agentGenerated ?? [],
    dependencies: [],
    declaredOutputs: [],
    dataFlowRefs: [],
    expectedSideEffect: node.expectedSideEffect,
    maxInvocations: node.maxInvocations,
  }));
  const prepared = await call(
    routes.prepare,
    `/api/v1/tasks/${taskId}/prepare`,
    world.backendKey,
    { plan: { schemaVersion: 1, taskId, nodes } },
    { taskId },
  );
  expect(prepared.body.status, JSON.stringify(prepared.body)).toBe("ready");
  expect(prepared.body.excludedSteps ?? []).toEqual([]);
  const session = await call(routes.sessions, "/api/v1/sessions", world.runtimeKey, { taskId });
  expect(session.http).toBe(200);
  return { taskId, token: session.body.token as string };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Runs one attempt with a fresh idempotency key (a new action, never a retry) and records what happened. */
async function runAttempt(task: { taskId: string; token: string }, attempt: ProofRunAttempt) {
  const before = { slack: slack.dispatches, gmail: gmail.requests };
  const idempotencyKey = `proof-run-${attempt.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const auth = await call(routes.authorize, "/api/v1/authorize", task.token, {
    taskId: task.taskId,
    tool: attempt.tool,
    operation: attempt.tool.split(".")[1],
    arguments: attempt.arguments,
    idempotencyKey,
  });
  const capability = (auth.body.capability as { token?: string } | null)?.token ?? null;
  let result: ProofRunResult = "blocked_before_dispatch";
  let receipt: ProofRunTranscriptAttempt["receipt"] = null;
  if (capability) {
    const exec = await call(routes.execute, "/api/v1/execute", task.token, {
      capability,
      tool: attempt.tool,
      operation: attempt.tool.split(".")[1],
      arguments: attempt.arguments,
      idempotencyKey,
    });
    const delivery = exec.body.delivery as { status?: string } | undefined;
    if (exec.http === 200 && exec.body.result === "succeeded") {
      result = delivery?.status === "held" ? "result_held" : "executed";
      const receiptId = String(exec.body.receiptId ?? "");
      receipt = { result: "succeeded", receiptId: `local-receipt-…${receiptId.slice(-6)}` };
    } else if (exec.http === 504) {
      result = "indeterminate";
    } else {
      result = "failed";
    }
  }
  const dispatches = slack.dispatches - before.slack + (gmail.requests - before.gmail);
  const recorded: ProofRunTranscriptAttempt = {
    id: attempt.id,
    decision: String(auth.body.status ?? `http_${auth.http}`),
    reasonCodes: (auth.body.reasonCodes as string[] | undefined) ?? [],
    summary: String(auth.body.summary ?? "").replace(UUID, "…"),
    dispatches,
    result,
    receipt,
  };
  transcript.push(recorded);
  return recorded;
}

beforeAll(async () => {
  configureLocalEnv();
  delete process.env.SLACK_FIXTURE_MODE;
  delete process.env.GMAIL_FIXTURE_MODE;
  const { createSlackConnector, defaultSlackConnectorDeps } =
    await import("@/lib/connectors/slack/connector");
  const { createGmailConnector, defaultGmailConnectorDeps } =
    await import("@/lib/connectors/gmail/connector");
  const { registerConnector, resetConnectorRegistryForTests } = await import("@/lib/connectors/registry");
  resetConnectorRegistryForTests();
  registerConnector(createSlackConnector({ ...defaultSlackConnectorDeps, fetch: slack.fetch }));
  registerConnector(createGmailConnector({ ...defaultGmailConnectorDeps, fetch: gmail.fetch }));
  routes = await loadRoutes();
  await setUp();
}, 120_000);

afterAll(async () => {
  // For `npm run authority -- demo`: what each attempt did next to what the recipe expected (no secrets or IDs).
  if (process.env.PROOF_RUN_REPORT) {
    const byId = new Map(transcript.map((t) => [t.id, t]));
    writeFileSync(
      process.env.PROOF_RUN_REPORT,
      JSON.stringify({
        title: recipe.title,
        recipeHash: recipeHash(recipe),
        attempts: recipe.attempts.map((a) => ({
          id: a.id,
          label: a.label,
          expect: a.expect,
          got: byId.get(a.id) ?? null,
        })),
        slackDispatches: slack.dispatches,
        gmailRequests: gmail.requests,
      }),
    );
  }
  try {
    if (world.connectionId) {
      const { disconnectConnectorConnection } = await import("@/lib/gateway/rpc-connectors");
      await disconnectConnectorConnection({
        tenantId: TENANT_A_ID,
        userId: ADMIN_A_USER_ID,
        connectionId: world.connectionId,
      });
    }
    await purgeProofRunConnections();
  } finally {
    await db?.end();
  }
});

/**
 * Removes this runner's own throwaway Slack connections (name prefix "proof-run", tenant A, already disconnected)
 * and their rows from the LOCAL database, as the Slack integration fixture does. Disconnecting alone keeps the mock
 * token row, which would block other local suites that reset tenant A's connections.
 */
async function purgeProofRunConnections() {
  await db.query("begin");
  try {
    await db.query("select set_config('authority.allow_demo_purge', 'on', true)");
    const ids = `(select id from public.connector_connections where tenant_id = $1 and connector_id = 'slack'
                  and status = 'disconnected' and name like '${CONNECTION_NAME_PREFIX}-%')`;
    for (const table of [
      "connector_execution_receipts",
      "connector_reservations",
      "task_connector_bindings",
      "connection_delegations",
      "connector_connection_secrets",
    ]) {
      await db.query(`delete from public.${table} where connection_id in ${ids}`, [TENANT_A_ID]);
    }
    await db.query(`delete from public.connector_connections where id in ${ids}`, [TENANT_A_ID]);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    console.warn(`proof-run cleanup skipped: ${(error as Error).message}`);
  }
}

describe(`Proof Run: ${recipe.title}`, () => {
  const runs = taskRunsFor(recipe);

  for (const run of runs) {
    it(`${run.map((a) => a.label).join(", then ")} (${run.length > 1 ? "same task" : "fresh task"})`, async () => {
      const task = await openTask();
      for (const attempt of run) {
        const got = await runAttempt(task, attempt);
        const label = `${attempt.label}: ${JSON.stringify(got)}`;
        if (attempt.expect.outcome === "executed") {
          expect(got.result, label).toBe("executed");
          expect(got.receipt, label).not.toBeNull();
        } else {
          expect(got.result, label).toBe("blocked_before_dispatch");
          expect(["allow", "allow_constrained"], label).not.toContain(got.decision);
          if (attempt.expect.reasonCode) expect(got.reasonCodes, label).toContain(attempt.expect.reasonCode);
        }
        expect(got.dispatches, label).toBe(attempt.expect.dispatches);
      }
    });
  }

  it("reached the mock provider exactly as often as the recipe expects, and never Gmail", () => {
    const expected = recipe.attempts.reduce((sum, a) => sum + a.expect.dispatches, 0);
    expect(slack.dispatches).toBe(expected);
    expect(gmail.requests).toBe(0);
    // The posted message went to the pinned channel only.
    const channels = slack.requests
      .filter((r) => r.path === "/api/chat.postMessage")
      .map((r) => r.body?.channel);
    const pinned = recipe.plan.map((n) => n.arguments.channel).filter(Boolean);
    for (const channel of channels) expect(pinned).toContain(channel);
  });

  it("writes the sanitized transcript when PROOF_RUN_CAPTURE=1", () => {
    if (process.env.PROOF_RUN_CAPTURE !== "1") return;
    const byId = new Map(transcript.map((t) => [t.id, t]));
    const captured: ProofRunTranscript = {
      schemaVersion: 1,
      recipeId: recipe.id,
      recipeHash: recipeHash(recipe),
      source: "local-fixture",
      provider: "mock-slack",
      capturedAt: new Date().toISOString(),
      attempts: recipe.attempts.map((a) => byId.get(a.id)!),
    };
    const text = JSON.stringify(captured, null, 2);
    expect(text).not.toContain(MOCK_BOT_TOKEN);
    expect(text).not.toMatch(UUID);
    expect(text).not.toMatch(/authority_(ts|bk|ak|rk)_/);
    writeFileSync(CAPTURE_PATH, `${text}\n`);
  });
});
