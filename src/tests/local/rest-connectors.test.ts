import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SafeFetchInput, SafeFetchResult } from "@/lib/connectors/custom-api/network-guard";
import type { Database } from "@/lib/supabase/database.types";

import { FIXTURE_PASSWORD, localSupabaseEnv, OWNER_A } from "./local-env";
import { configureLocalEnv, loadRoutes, request } from "./mock-provider-fixture";

/**
 * Declarative REST connectors through Authority's own API route handlers -- task, prepare, session, authorize,
 * execute -- against a throwaway LOCAL Supabase. The provider is a MOCK transport injected into the generic REST
 * connector for Sentry (bearer token) and Zendesk (basic auth on a per-account subdomain). Nothing leaves the
 * machine. It shows that the generated registry entries, the connector and the runtime agree: an in-contract call
 * reaches exactly the expected URL with the stored credential; anything outside the contract never reaches it.
 */

const TENANT_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_A_USER_ID = "a0000000-0000-4000-8000-000000000001";
const PREFIX = "rest-connectors";
const SENTRY_TOKEN = "sntrys_mock_not_a_real_token";
const ZENDESK_TOKEN = "zd-mock-not-a-real-token";

class MockProvider {
  requests: Array<{ method: string; url: string; auth: string | undefined; body: string | undefined }> = [];
  fetch = async (input: SafeFetchInput): Promise<SafeFetchResult> => {
    this.requests.push({
      method: input.method,
      url: input.url.toString(),
      auth: input.headers.authorization,
      body: input.body,
    });
    return {
      status: 200,
      headers: new Headers({
        "content-type": "application/json",
        "x-request-id": `mock-${this.requests.length}`,
      }),
      bodyText: JSON.stringify({ id: "42", title: "Mock issue", status: "unresolved" }),
      truncated: false,
    };
  };
}

const provider = new MockProvider();
let routes: Awaited<ReturnType<typeof loadRoutes>>;
let db: pg.Client;
let owner: SupabaseClient<Database>;
const world = { backendKey: "", runtimeKey: "", agentId: "", customerId: "", sentry: "", zendesk: "" };
let seq = 0;

async function connection(connectorId: string, secret: string, config?: Record<string, string>) {
  const { createConnectorConnection } = await import("@/lib/gateway/rpc-connectors");
  const { setConnectorSecret, updateConnectorConnectionConfig } =
    await import("@/lib/gateway/rpc-connector-secrets");
  const created = await createConnectorConnection({
    tenantId: TENANT_ID,
    userId: OWNER_A_USER_ID,
    connectorId,
    name: `${PREFIX}-${connectorId}-${Date.now().toString(36)}`,
    environment: "development",
  });
  if (created.status !== "ok" || !created.connectionId) throw new Error(`${connectorId}: ${created.status}`);
  if (config) {
    const saved = await updateConnectorConnectionConfig({
      tenantId: TENANT_ID,
      userId: OWNER_A_USER_ID,
      connectionId: created.connectionId,
      config,
    });
    if (saved !== "ok") throw new Error(`${connectorId} config: ${saved}`);
  }
  const stored = await setConnectorSecret({
    tenantId: TENANT_ID,
    userId: OWNER_A_USER_ID,
    connectionId: created.connectionId,
    secretType: "api_key",
    plaintextSecret: secret,
  });
  if (stored !== "ok") throw new Error(`${connectorId} secret: ${stored}`);
  const { data: grant } = await owner.rpc("grant_connection_delegation", {
    p_connection_id: created.connectionId,
    p_customer_id: world.customerId,
  });
  if (grant !== "ok") throw new Error(`grant ${connectorId}: ${grant}`);
  return created.connectionId;
}

async function setUp() {
  const env = localSupabaseEnv();
  db = new pg.Client({ connectionString: env.dbUrl });
  await db.connect();
  owner = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } });
  const { error } = await owner.auth.signInWithPassword({ email: OWNER_A, password: FIXTURE_PASSWORD });
  if (error) throw new Error(`sign-in: ${error.message}`);
  await db.query(
    `insert into public.tenants (id, name, slug, environment, created_by)
     values ($1, 'REST connectors (local test)', 'rest-connectors-local', 'development', $2) on conflict (id) do nothing`,
    [TENANT_ID, OWNER_A_USER_ID],
  );
  await db.query(
    `insert into public.tenant_memberships (tenant_id, user_id, role) values ($1, $2, 'owner') on conflict do nothing`,
    [TENANT_ID, OWNER_A_USER_ID],
  );
  // Only one unverified connection per connector per tenant: retire this suite's earlier ones.
  await db.query(
    `update public.connector_connections set status = 'disconnected', disconnected_at = now()
      where tenant_id = $1 and name like $2 and status <> 'disconnected'`,
    [TENANT_ID, `${PREFIX}-%`],
  );

  const stamp = `${PREFIX}-${Date.now().toString(36)}`;
  const { data: app } = await owner.rpc("create_application", {
    p_tenant_id: TENANT_ID,
    p_name: stamp,
    p_slug: stamp,
    p_environment: "production",
  });
  const appId = app![0]!.app_application_id as string;
  await owner.rpc("set_application_require_task_sessions", { p_application_id: appId, p_required: true });
  const { data: bk } = await owner.rpc("create_backend_credential", {
    p_application_id: appId,
    p_name: stamp,
  });
  const { data: principal } = await owner.rpc("ensure_human_principal_for_current_user", {
    p_tenant_id: TENANT_ID,
  });
  const { data: agent } = await owner
    .from("agents")
    .insert({
      tenant_id: TENANT_ID,
      name: stamp,
      model: "none",
      model_provider: "none",
      framework: "rest-test",
      owner_principal_id: principal as string,
    })
    .select("id")
    .single();
  const { data: ak } = await owner.rpc("create_agent_credential", { p_agent_id: agent!.id });
  world.backendKey = bk![0]!.plaintext_secret as string;
  world.runtimeKey = ak![0]!.plaintext_secret as string;
  world.agentId = agent!.id;
  const customer = await request(routes.customers, "/api/v1/customers", world.backendKey, {
    externalId: `${stamp}-user`,
  });
  world.customerId = customer.body.customerId as string;
  world.sentry = await connection("sentry", SENTRY_TOKEN);
  world.zendesk = await connection("zendesk", ZENDESK_TOKEN, { subdomain: "acme", email: "agent@acme.test" });
}

interface Node {
  tool: string;
  arguments: Record<string, string | number | boolean>;
  agentGenerated?: string[];
  expectedSideEffect: string;
}

async function openTask(connectorId: string, connectionId: string, nodes: Node[]) {
  const created = await request(
    routes.tasks,
    `/api/v1/customers/${world.customerId}/tasks`,
    world.backendKey,
    {
      agentId: world.agentId,
      intent: "Triage the reported issue",
      connections: [{ connectorId, connectionId }],
      idempotencyKey: `${PREFIX}-task-${Date.now()}-${++seq}`,
    },
    { customerId: world.customerId },
  );
  expect(created.http, JSON.stringify(created.body)).toBe(201);
  const taskId = created.body.taskId as string;
  const prepared = await request(
    routes.prepare,
    `/api/v1/tasks/${taskId}/prepare`,
    world.backendKey,
    {
      plan: {
        schemaVersion: 1,
        taskId,
        nodes: nodes.map((n, i) => ({
          id: `step-${i + 1}`,
          sequence: i,
          tool: n.tool,
          arguments: n.arguments,
          agentGenerated: n.agentGenerated ?? [],
          dependencies: [],
          declaredOutputs: [],
          dataFlowRefs: [],
          expectedSideEffect: n.expectedSideEffect,
          maxInvocations: 1,
        })),
      },
    },
    { taskId },
  );
  expect(prepared.body.status, JSON.stringify(prepared.body)).toBe("ready");
  const session = await request(routes.sessions, "/api/v1/sessions", world.runtimeKey, { taskId });
  expect(session.http).toBe(200);
  return { taskId, token: session.body.token as string };
}

async function attempt(task: { taskId: string; token: string }, tool: string, args: Record<string, unknown>) {
  const before = provider.requests.length;
  const idempotencyKey = `${PREFIX}-${Date.now()}-${++seq}`;
  const auth = await request(routes.authorize, "/api/v1/authorize", task.token, {
    taskId: task.taskId,
    tool,
    operation: tool.split(".")[1],
    arguments: args,
    idempotencyKey,
  });
  const capability = (auth.body.capability as { token?: string } | null)?.token ?? null;
  let exec: Awaited<ReturnType<typeof request>> | null = null;
  if (capability) {
    exec = await request(routes.execute, "/api/v1/execute", task.token, {
      capability,
      tool,
      operation: tool.split(".")[1],
      arguments: args,
      idempotencyKey,
    });
  }
  return {
    status: String(auth.body.status),
    reasons: (auth.body.reasonCodes as string[] | undefined) ?? [],
    executed: exec?.http === 200 && exec.body.result === "succeeded",
    sent: provider.requests.slice(before),
  };
}

beforeAll(async () => {
  configureLocalEnv();
  const { createRestConnector, defaultRestConnectorDeps } = await import("@/lib/connectors/rest/connector");
  const { sentry } = await import("@/lib/connectors/rest/providers/sentry");
  const { zendesk } = await import("@/lib/connectors/rest/providers/zendesk");
  const { registerConnector, resetConnectorRegistryForTests } = await import("@/lib/connectors/registry");
  resetConnectorRegistryForTests();
  registerConnector(createRestConnector(sentry, { ...defaultRestConnectorDeps, fetch: provider.fetch }));
  registerConnector(createRestConnector(zendesk, { ...defaultRestConnectorDeps, fetch: provider.fetch }));
  routes = await loadRoutes();
  await setUp();
}, 120_000);

afterAll(async () => {
  await db?.query(
    `update public.connector_connections set status = 'disconnected', disconnected_at = now()
      where tenant_id = $1 and name like $2 and status <> 'disconnected'`,
    [TENANT_ID, `${PREFIX}-%`],
  );
  await db?.end();
});

describe("a declarative REST connector (Sentry, bearer token)", () => {
  it("sends an in-contract read to exactly the expected URL with the stored token, once", async () => {
    const task = await openTask("sentry", world.sentry, [
      {
        tool: "sentry.get_issue",
        arguments: { organization_slug: "acme", issue_id: "42" },
        expectedSideEffect: "read",
      },
    ]);
    const ok = await attempt(task, "sentry.get_issue", { organization_slug: "acme", issue_id: "42" });
    expect(ok.status).toMatch(/^allow/);
    expect(ok.executed).toBe(true);
    expect(ok.sent).toEqual([
      {
        method: "GET",
        url: "https://sentry.io/api/0/organizations/acme/issues/42/",
        auth: `Bearer ${SENTRY_TOKEN}`,
        body: undefined,
      },
    ]);
  });

  it("never reaches Sentry for another issue, an extra argument, or a write the plan did not include", async () => {
    const task = await openTask("sentry", world.sentry, [
      {
        tool: "sentry.get_issue",
        arguments: { organization_slug: "acme", issue_id: "42" },
        expectedSideEffect: "read",
      },
    ]);
    const other = await attempt(task, "sentry.get_issue", { organization_slug: "acme", issue_id: "43" });
    const extra = await attempt(task, "sentry.get_issue", {
      organization_slug: "acme",
      issue_id: "42",
      expand: "x",
    });
    const write = await attempt(task, "sentry.resolve_issue", { organization_slug: "acme", issue_id: "42" });
    for (const denied of [other, extra, write]) {
      expect(denied.status).not.toMatch(/^allow/);
      expect(denied.sent).toEqual([]);
    }
  });

  it("sends a planned write with its fixed body, and only once", async () => {
    const task = await openTask("sentry", world.sentry, [
      {
        tool: "sentry.resolve_issue",
        arguments: { organization_slug: "acme", issue_id: "42" },
        expectedSideEffect: "write_update",
      },
    ]);
    const first = await attempt(task, "sentry.resolve_issue", { organization_slug: "acme", issue_id: "42" });
    expect(first.executed).toBe(true);
    expect(first.sent).toHaveLength(1);
    expect(first.sent[0]).toMatchObject({ method: "PUT", body: JSON.stringify({ status: "resolved" }) });
    const second = await attempt(task, "sentry.resolve_issue", { organization_slug: "acme", issue_id: "42" });
    expect(second.status).not.toMatch(/^allow/);
    expect(second.sent).toEqual([]);
  });
});

describe("a declarative REST connector (Zendesk, basic auth on the account's subdomain)", () => {
  it("posts a planned comment to the account's own host, with agent-written text", async () => {
    const task = await openTask("zendesk", world.zendesk, [
      {
        tool: "zendesk.add_comment",
        arguments: { ticket_id: 7, public: false },
        agentGenerated: ["body"],
        expectedSideEffect: "write_update",
      },
    ]);
    const sent = await attempt(task, "zendesk.add_comment", {
      ticket_id: 7,
      public: false,
      body: "Looking into it.",
    });
    expect(sent.executed, JSON.stringify(sent)).toBe(true);
    expect(sent.sent).toEqual([
      {
        method: "PUT",
        url: "https://acme.zendesk.com/api/v2/tickets/7.json",
        auth: `Basic ${Buffer.from(`agent@acme.test/token:${ZENDESK_TOKEN}`).toString("base64")}`,
        body: JSON.stringify({ ticket: { comment: { body: "Looking into it.", public: false } } }),
      },
    ]);
    const publicReply = await attempt(task, "zendesk.add_comment", {
      ticket_id: 7,
      public: true,
      body: "Hi",
    });
    expect(publicReply.status).not.toMatch(/^allow/);
    expect(publicReply.sent).toEqual([]);
  });

  it("refuses to call anywhere when the stored subdomain has been tampered with", async () => {
    const { createRestConnector, defaultRestConnectorDeps } = await import("@/lib/connectors/rest/connector");
    const { zendesk } = await import("@/lib/connectors/rest/providers/zendesk");
    await db.query(
      `update public.connector_connections set config = jsonb_set(config, '{subdomain}', '"evil.example#"') where id = $1`,
      [world.zendesk],
    );
    try {
      const connector = createRestConnector(zendesk, { ...defaultRestConnectorDeps, fetch: provider.fetch });
      const before = provider.requests.length;
      const health = await connector.verifyInstallation({ connectionId: world.zendesk });
      expect(health.status).toBe("not_configured");
      expect(health.reasons).toEqual(["CONFIG_INVALID:subdomain"]);
      expect(provider.requests.length).toBe(before);
    } finally {
      await db.query(
        `update public.connector_connections set config = jsonb_set(config, '{subdomain}', '"acme"') where id = $1`,
        [world.zendesk],
      );
    }
  });
});
