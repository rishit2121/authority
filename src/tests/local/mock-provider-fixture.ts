import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import pg from "pg";

import type { SafeFetchInput, SafeFetchResult } from "@/lib/connectors/custom-api/network-guard";
import type { Database } from "@/lib/supabase/database.types";

import { FIXTURE_PASSWORD, localSupabaseEnv, OWNER_A } from "./local-env";

/**
 * Shared setup for the cross-entrypoint regression and execution-race suites, against a throwaway LOCAL Supabase
 * only (local-env.ts refuses anything else).
 *
 * The "provider" is a CONTROLLABLE MOCK: a Custom API connector whose HTTP layer is replaced in-process, so a test
 * can hold a request in flight, fail it, or count it. Nothing leaves the machine. This exercises Authority's own
 * reservation, dispatch, settlement and accounting; it says nothing about how a real provider behaves.
 */

export const TENANT_A_ID = "11111111-1111-4111-8111-111111111111";
export const ADMIN_A_USER_ID = "a0000000-0000-4000-8000-000000000002";
export const DEV_A_USER_ID = "a0000000-0000-4000-8000-000000000003";

export function configureLocalEnv() {
  const env = localSupabaseEnv();
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL: env.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.anonKey,
    GATEWAY_DATABASE_URL:
      process.env.LOCAL_GATEWAY_DATABASE_URL ??
      "postgresql://authority_gateway:ci-only-gateway-password@127.0.0.1:54322/postgres",
    GATEWAY_DATABASE_SSL: "disable",
    AUTHORITY_DEPLOYMENT: "local",
    OPENAI_API_KEY: "",
    OPENROUTER_API_KEY: "",
  });
  return env;
}

/** The mock provider. `mode` decides what the next request does. */
export class ControllableProvider {
  requests: SafeFetchInput[] = [];
  mode: "succeed" | "hold" | "transport_error" = "succeed";
  private held: Array<() => void> = [];

  fetch = async (input: SafeFetchInput): Promise<SafeFetchResult> => {
    this.requests.push(input);
    const mode = this.mode;
    if (mode === "hold") await new Promise<void>((resolve) => this.held.push(resolve));
    if (mode === "transport_error") throw new Error("ECONNRESET (simulated)");
    return {
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      bodyText: JSON.stringify({ ok: true, request: this.requests.length }),
      truncated: false,
    };
  };

  /** Resolves once at least `count` requests have reached the provider (a request that is now in flight). */
  async waitForRequests(count: number, timeoutMs = 10_000) {
    const start = Date.now();
    while (this.requests.length < count) {
      if (Date.now() - start > timeoutMs)
        throw new Error(`provider saw ${this.requests.length} of ${count} requests`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  releaseAll() {
    for (const release of this.held.splice(0)) release();
  }
}

export type Handler = (
  req: NextRequest,
  ctx?: { params: Promise<Record<string, string>> },
) => Promise<Response>;

export async function loadRoutes() {
  const load = async (path: string, method = "POST") => (await import(path))[method] as unknown as Handler;
  return {
    customers: await load("@/app/api/v1/customers/route"),
    tasks: await load("@/app/api/v1/customers/[customerId]/tasks/route"),
    prepare: await load("@/app/api/v1/tasks/[taskId]/prepare/route"),
    sessions: await load("@/app/api/v1/sessions/route"),
    authorize: await load("@/app/api/v1/authorize/route"),
    execute: await load("@/app/api/v1/execute/route"),
    tools: await load("@/app/api/v1/tasks/[taskId]/tools/route", "GET"),
    mcp: await load("@/app/api/mcp/tasks/[taskId]/route"),
  };
}

export async function request(
  handler: Handler,
  path: string,
  token: string | null,
  body?: unknown,
  params?: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const req = new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const res = await handler(req, params ? { params: Promise.resolve(params) } : undefined);
  return { http: res.status, body: ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown> };
}

export interface LocalWorld {
  db: pg.Client;
  owner: SupabaseClient<Database>;
  appId: string;
  backendKey: string;
  runtimeKey: string;
  agentId: string;
  customerId: string;
  connectionId: string;
  connectorId: string;
  readTool: string;
  writeTool: string;
}

/**
 * One application (sessions required), one agent, one customer, and one Custom API connection with two published
 * operations — `get_order` (read; `orderId` pins, optional `expand` free to differ) and `create_refund` (write,
 * opted in to automatic execution for this application) — delegated to the customer.
 */
export async function createLocalWorld(label: string): Promise<LocalWorld> {
  const env = localSupabaseEnv();
  const db = new pg.Client({ connectionString: env.dbUrl });
  await db.connect();
  const owner = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } });
  const { error } = await owner.auth.signInWithPassword({ email: OWNER_A, password: FIXTURE_PASSWORD });
  if (error) throw new Error(`sign-in: ${error.message}`);

  const stamp = `${label}-${Date.now().toString(36)}`;
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
      model: "u",
      model_provider: "u",
      framework: "u",
      owner_principal_id: principal as string,
    })
    .select("id")
    .single();
  if (agentError || !agent) throw new Error(`agent: ${agentError?.message}`);
  const { data: ak } = await owner.rpc("create_agent_credential", { p_agent_id: agent.id });

  const { toCustomApiConnectorId } = await import("@/lib/connectors/custom-api/connection-id");
  const { createConnectorConnection } = await import("@/lib/gateway/rpc-connectors");
  const { setConnectorSecret, updateConnectorConnectionConfig } =
    await import("@/lib/gateway/rpc-connector-secrets");
  const { createCustomOperationDraft, publishCustomOperation, validateCustomOperation } =
    await import("@/lib/gateway/rpc-custom-operations");
  const connectionId = randomUUID();
  const connectorId = toCustomApiConnectorId(connectionId);
  const created = await createConnectorConnection({
    tenantId: TENANT_A_ID,
    userId: ADMIN_A_USER_ID,
    connectorId,
    name: stamp,
    environment: "development",
    connectionId,
  });
  if (created.status !== "ok") throw new Error(`connection: ${created.status}`);
  const configured = await updateConnectorConnectionConfig({
    tenantId: TENANT_A_ID,
    userId: ADMIN_A_USER_ID,
    connectionId,
    config: { baseUrl: "https://orders.mock-provider.test" },
  });
  if (configured !== "ok") throw new Error(`config: ${configured}`);
  const secret = await setConnectorSecret({
    tenantId: TENANT_A_ID,
    userId: ADMIN_A_USER_ID,
    connectionId,
    secretType: "bearer_token",
    plaintextSecret: "mock-provider-token",
  });
  if (secret !== "ok") throw new Error(`secret: ${secret}`);

  const publish = async (
    slug: string,
    method: "GET" | "POST",
    pathTemplate: string,
    effect: "read" | "write_create",
    fields: unknown[],
  ) => {
    const draft = await createCustomOperationDraft({
      tenantId: TENANT_A_ID,
      userId: DEV_A_USER_ID,
      connectionId,
      operationSlug: slug,
      name: slug,
      description: null,
      method,
      pathTemplate,
      effect,
      inputSchema: { schemaVersion: 1, fields },
      requestMapping: { schemaVersion: 1 },
      authType: "bearer",
      authConfig: { schemaVersion: 1 },
      timeoutMs: 5000,
      invocationLimit: null,
    });
    if (draft.status !== "ok" || !draft.operationId) throw new Error(`draft ${slug}: ${draft.status}`);
    const validated = await validateCustomOperation({
      tenantId: TENANT_A_ID,
      userId: DEV_A_USER_ID,
      operationId: draft.operationId,
    });
    if (validated.status !== "ok") throw new Error(`validate ${slug}: ${validated.status}`);
    const published = await publishCustomOperation({
      tenantId: TENANT_A_ID,
      userId: ADMIN_A_USER_ID,
      operationId: draft.operationId,
    });
    if (published !== "ok") throw new Error(`publish ${slug}: ${published}`);
    return draft.operationId;
  };
  await publish("get_order", "GET", "/v1/orders/{orderId}", "read", [
    { key: "orderId", type: "string", required: true, identifiesResource: true, in: "path" },
    { key: "expand", type: "string", required: false, identifiesResource: false, in: "query" },
  ]);
  const writeOpId = await publish("create_refund", "POST", "/v1/orders/{orderId}/refunds", "write_create", [
    { key: "orderId", type: "string", required: true, identifiesResource: true, in: "path" },
  ]);
  const optIn = await owner.rpc("set_custom_operation_auto_execute", {
    p_application_id: appId,
    p_operation_definition_id: writeOpId,
    p_enabled: true,
    p_note: "local mock-provider tests",
  });
  if (optIn.data !== "ok") throw new Error(`auto-execute: ${JSON.stringify(optIn)}`);

  const routes = await loadRoutes();
  const customer = await request(routes.customers, "/api/v1/customers", bk![0].plaintext_secret as string, {
    externalId: stamp,
  });
  const customerId = customer.body.customerId as string;
  await db.query(
    `insert into public.connection_delegations (tenant_id, connection_id, customer_id) values ($1, $2, $3)`,
    [TENANT_A_ID, connectionId, customerId],
  );

  return {
    db,
    owner,
    appId,
    backendKey: bk![0].plaintext_secret as string,
    runtimeKey: ak![0].plaintext_secret as string,
    agentId: agent.id,
    customerId,
    connectionId,
    connectorId,
    readTool: `${connectorId}.get_order`,
    writeTool: `${connectorId}.create_refund`,
  };
}

/** Creates and prepares a task bound to the world's connection; returns the task id and a task-session token. */
export async function preparedTask(world: LocalWorld, nodes: unknown[], intent = "Look up order 4821") {
  const routes = await loadRoutes();
  const created = await request(
    routes.tasks,
    `/api/v1/customers/${world.customerId}/tasks`,
    world.backendKey,
    {
      agentId: world.agentId,
      intent,
      connections: [{ connectorId: world.connectorId, connectionId: world.connectionId }],
    },
    { customerId: world.customerId },
  );
  if (created.http !== 201) throw new Error(`task: ${created.http} ${JSON.stringify(created.body)}`);
  const taskId = created.body.taskId as string;
  const prepared = await request(
    routes.prepare,
    `/api/v1/tasks/${taskId}/prepare`,
    world.backendKey,
    {
      plan: { schemaVersion: 1, taskId, nodes },
    },
    { taskId },
  );
  if (prepared.body.status !== "ready") throw new Error(`prepare: ${JSON.stringify(prepared.body)}`);
  const session = await request(routes.sessions, "/api/v1/sessions", world.runtimeKey, { taskId });
  if (session.http !== 200) throw new Error(`session: ${session.http}`);
  return { taskId, token: session.body.token as string };
}
