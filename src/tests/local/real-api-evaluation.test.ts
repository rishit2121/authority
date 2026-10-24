import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";

import { FIXTURE_PASSWORD, localSupabaseEnv, OWNER_A } from "./local-env";

/**
 * A small, fresh evaluation of Authority's runtime boundary through its REAL API route handlers, against a
 * throwaway LOCAL Supabase (local-env.ts refuses any other target). No model is called (model keys are blank) and
 * no provider is contacted: this exercises task creation, compilation, sessions and authorization decisions, which
 * are deterministic. Setup goes through the same RPCs the dashboard's quick setup uses.
 *
 * Every attempt is recorded as legitimate or unauthorized, with its decision and latency; the suite prints a
 * summary (legitimate completed, unauthorized refused, false holds, latency percentiles). Executions against
 * providers are out of scope here: unauthorized attempts are measured at the authorization decision.
 */

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

type Handler = (req: NextRequest, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;
const routes: Record<string, Handler> = {};
let db: pg.Client;
let owner: SupabaseClient<Database>;
const keys: Record<string, string> = {};
const ids: Record<string, string> = {};

interface Attempt {
  name: string;
  kind: "legitimate" | "unauthorized";
  http: number;
  status: string | null;
  code: string | null;
  ms: number;
}
const attempts: Attempt[] = [];

async function call(
  name: string,
  path: string,
  token: string,
  body: unknown,
  params?: Record<string, string>,
) {
  const req = new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const t0 = performance.now();
  const res = await routes[name](req, params ? { params: Promise.resolve(params) } : undefined);
  const ms = performance.now() - t0;
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { http: res.status, body: json ?? {}, ms };
}

let seq = 0;
async function authorize(
  name: string,
  kind: Attempt["kind"],
  token: string,
  taskId: string,
  tool: string,
  args: Record<string, unknown>,
  idempotencyKey = `k-${++seq}-${Date.now()}`,
) {
  const r = await call("authorize", "/api/v1/authorize", token, {
    taskId,
    tool,
    operation: tool.split(".")[1],
    arguments: args,
    idempotencyKey,
  });
  const error = (r.body.error ?? null) as { code?: string } | null;
  attempts.push({
    name,
    kind,
    http: r.http,
    status: (r.body.status as string) ?? null,
    code: error?.code ?? (r.body.reasonCodes as string[] | undefined)?.[0] ?? null,
    ms: r.ms,
  });
  return r;
}
const permitted = (r: { body: Record<string, unknown> }) =>
  ["allow", "allow_constrained"].includes(String(r.body.status));

async function newTask(intent: string, nodes: unknown[], customerId = ids.customer) {
  const created = await call(
    "tasks",
    `/api/v1/customers/${customerId}/tasks`,
    keys.backend,
    {
      agentId: ids.agent,
      intent,
    },
    { customerId },
  );
  expect(created.http).toBe(201);
  const taskId = created.body.taskId as string;
  const prepared = await call(
    "prepare",
    `/api/v1/tasks/${taskId}/prepare`,
    keys.backend,
    {
      plan: { schemaVersion: 1, taskId, nodes },
    },
    { taskId },
  );
  return { taskId, prepared };
}

async function sessionFor(taskId: string) {
  const s = await call("sessions", "/api/v1/sessions", keys.runtime, { taskId });
  expect(s.http).toBe(200);
  return s.body as { token: string; sessionId: string };
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: env.dbUrl });
  await db.connect();

  owner = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await owner.auth.signInWithPassword({
    email: OWNER_A,
    password: FIXTURE_PASSWORD,
  });
  if (signInError) throw new Error(`sign-in failed: ${signInError.message}`);
  ids.tenant = (
    await db.query(
      `select m.tenant_id from public.tenant_memberships m join auth.users u on u.id = m.user_id
       where u.email = $1 and m.role = 'owner' limit 1`,
      [OWNER_A],
    )
  ).rows[0].tenant_id;

  const app = async (slug: string) => {
    const { data, error } = await owner.rpc("create_application", {
      p_tenant_id: ids.tenant,
      p_name: slug,
      p_slug: slug,
      p_environment: "production",
    });
    if (error || data?.[0]?.app_status !== "ok") throw new Error(`create_application: ${error?.message}`);
    return data[0].app_application_id as string;
  };
  const stamp = Date.now().toString(36);
  ids.app = await app(`eval-${stamp}`);
  ids.otherApp = await app(`eval-other-${stamp}`);
  await owner.rpc("set_application_require_task_sessions", { p_application_id: ids.app, p_required: true });

  const backendKey = async (applicationId: string) => {
    const { data, error } = await owner.rpc("create_backend_credential", {
      p_application_id: applicationId,
      p_name: "real-api evaluation",
    });
    if (error || !data?.[0]) throw new Error(`create_backend_credential: ${error?.message}`);
    return data[0].plaintext_secret as string;
  };
  keys.backend = await backendKey(ids.app);
  keys.otherBackend = await backendKey(ids.otherApp);

  const { data: principalId, error: principalError } = await owner.rpc(
    "ensure_human_principal_for_current_user",
    {
      p_tenant_id: ids.tenant,
    },
  );
  if (principalError || !principalId) throw new Error(`principal: ${principalError?.message}`);
  const { data: agent, error: agentError } = await owner
    .from("agents")
    .insert({
      tenant_id: ids.tenant,
      name: `eval-agent-${stamp}`,
      model: "unspecified",
      model_provider: "unspecified",
      framework: "unspecified",
      owner_principal_id: principalId as string,
    })
    .select("id")
    .single();
  if (agentError || !agent) throw new Error(`agent insert: ${agentError?.message}`);
  ids.agent = agent.id;
  const { data: agentKey, error: agentKeyError } = await owner.rpc("create_agent_credential", {
    p_agent_id: agent.id,
  });
  if (agentKeyError || !agentKey?.[0]) throw new Error(`create_agent_credential: ${agentKeyError?.message}`);
  keys.runtime = agentKey[0].plaintext_secret as string;
  ids.runtimeCredential = agentKey[0].credential_id as string;

  routes.customers = (await import("@/app/api/v1/customers/route")).POST as unknown as Handler;
  routes.tasks = (await import("@/app/api/v1/customers/[customerId]/tasks/route")).POST as unknown as Handler;
  routes.prepare = (await import("@/app/api/v1/tasks/[taskId]/prepare/route")).POST as unknown as Handler;
  routes.sessions = (await import("@/app/api/v1/sessions/route")).POST as unknown as Handler;
  routes.revoke = (await import("@/app/api/v1/sessions/revoke/route")).POST as unknown as Handler;
  routes.authorize = (await import("@/app/api/v1/authorize/route")).POST as unknown as Handler;
  routes.mcp = (await import("@/app/api/mcp/tasks/[taskId]/route")).POST as unknown as Handler;

  const customer = await call("customers", "/api/v1/customers", keys.backend, {
    externalId: `cust-${stamp}`,
  });
  ids.customer = customer.body.customerId as string;
  const other = await call("customers", "/api/v1/customers", keys.otherBackend, {
    externalId: `cust-other-${stamp}`,
  });
  ids.otherCustomer = other.body.customerId as string;
}, 120_000);

afterAll(async () => {
  const legit = attempts.filter((a) => a.kind === "legitimate");
  const unauthorized = attempts.filter((a) => a.kind === "unauthorized");
  const allowed = (a: Attempt) => a.status === "allow" || a.status === "allow_constrained";
  const ms = attempts.map((a) => a.ms).sort((x, y) => x - y);
  const pct = (p: number) =>
    ms.length ? Math.round(ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]) : null;
  console.log(
    "REAL-API-EVALUATION " +
      JSON.stringify({
        authorizations: attempts.length,
        legitimate: legit.length,
        legitimateAllowed: legit.filter(allowed).length,
        falseHolds: legit.filter((a) => !allowed(a)).map((a) => a.name),
        unauthorized: unauthorized.length,
        unauthorizedRefused: unauthorized.filter((a) => !allowed(a)).length,
        unauthorizedAllowed: unauthorized.filter(allowed).map((a) => a.name),
        refusalCodes: Object.fromEntries(unauthorized.map((a) => [a.name, a.code ?? a.status])),
        latencyMs: { p50: pct(0.5), p95: pct(0.95), max: ms.length ? Math.round(ms[ms.length - 1]) : null },
        modelCalls: 0,
        providerCalls: 0,
      }),
  );
  await db?.end();
});

const SLACK = {
  id: "post",
  sequence: 1,
  tool: "slack.post_message",
  arguments: { channel: "C-ops", text: "Deployed." },
  expectedSideEffect: "write_create",
  maxInvocations: 2,
};
const LINEAR = {
  id: "issue",
  sequence: 2,
  tool: "linear.create_issue",
  arguments: { team_id: "T-1", title: "Checkout bug" },
  expectedSideEffect: "write_create",
  maxInvocations: 1,
};

describe("compiled contract, through the real API", () => {
  let taskId = "";
  let token = "";

  beforeAll(async () => {
    const { taskId: id, prepared } = await newTask(
      "Post the status to #ops and file the checkout bug in Linear.",
      [SLACK, LINEAR],
    );
    expect(prepared.body.status).toBe("ready");
    taskId = id;
    token = (await sessionFor(taskId)).token;
  });

  it("allows the pinned calls, with optional free text left open", async () => {
    expect(
      permitted(
        await authorize("slack pinned channel", "legitimate", token, taskId, "slack.post_message", {
          channel: "C-ops",
          text: "Deployed.",
        }),
      ),
    ).toBe(true);
    expect(
      permitted(
        await authorize("linear pinned team", "legitimate", token, taskId, "linear.create_issue", {
          team_id: "T-1",
          title: "Checkout bug",
          description: "Steps to reproduce...",
        }),
      ),
    ).toBe(true);
  });

  it("refuses a changed recipient, a changed resource and a changed value", async () => {
    for (const [name, tool, args] of [
      ["slack other channel", "slack.post_message", { channel: "C-attacker", text: "x" }],
      ["linear other team", "linear.create_issue", { team_id: "T-2", title: "Checkout bug" }],
      ["linear other title", "linear.create_issue", { team_id: "T-1", title: "Something else" }],
    ] as const) {
      const r = await authorize(name, "unauthorized", token, taskId, tool, args);
      expect(permitted(r)).toBe(false);
    }
  });

  it("refuses an argument the plan never set (closed-world arguments)", async () => {
    const r = await authorize("slack extra argument", "unauthorized", token, taskId, "slack.post_message", {
      channel: "C-ops",
      text: "Deployed.",
      thread_ts: "1",
    });
    expect(r.body.status).toBe("deny");
  });

  it("refuses a tool outside the contract", async () => {
    const r = await authorize("tool not in contract", "unauthorized", token, taskId, "gmail.send_email", {
      to: "a@example.com",
      subject: "s",
    });
    expect(permitted(r)).toBe(false);
  });

  it("replays a repeated call instead of issuing a second capability", async () => {
    const key = `replay-${Date.now()}`;
    const first = await authorize(
      "slack replay first",
      "legitimate",
      token,
      taskId,
      "slack.post_message",
      { channel: "C-ops", text: "Deployed." },
      key,
    );
    const second = await call("authorize", "/api/v1/authorize", token, {
      taskId,
      tool: "slack.post_message",
      operation: "post_message",
      arguments: { channel: "C-ops", text: "Deployed." },
      idempotencyKey: key,
    });
    expect(second.body.decisionId).toBe(first.body.decisionId);
    expect(second.body.wasReplayed).toBe(true);
    expect((second.body.capability as { token: string | null } | null)?.token ?? null).toBeNull();
  });

  it("refuses once the action's budget is spent", async () => {
    const r = await authorize("slack over budget", "unauthorized", token, taskId, "slack.post_message", {
      channel: "C-ops",
      text: "Deployed.",
    });
    expect(r.body.status).toBe("deny");
    expect(r.body.reasonCodes).toContain("INVOCATION_LIMIT_REACHED");
  });
});

describe("the agent writes the message (docs/QUICKSTART.md, section 3)", () => {
  // The backend pins the channel and declares that the message text comes from an earlier step's output. The
  // contract then leaves `text` open, so the agent composes it at runtime; the channel stays pinned.
  let taskId = "";
  let token = "";

  beforeAll(async () => {
    const { taskId: id, prepared } = await newTask("Summarize Linear issue ENG-42 in #eng-updates.", [
      {
        id: "read-issue",
        sequence: 1,
        tool: "linear.get_issue",
        arguments: { issue_id: "ENG-42" },
        declaredOutputs: ["issue"],
        expectedSideEffect: "read",
      },
      {
        id: "post-summary",
        sequence: 2,
        tool: "slack.post_message",
        arguments: { channel: "C-eng-updates" },
        dataFlowRefs: [{ argumentKey: "text", fromNodeId: "read-issue", output: "issue" }],
        expectedSideEffect: "write_create",
      },
    ]);
    expect(prepared.body.status).toBe("ready");
    taskId = id;
    token = (await sessionFor(taskId)).token;
  });

  it("allows a message the agent composed, in the pinned channel", async () => {
    const r = await authorize("slack agent-written text", "legitimate", token, taskId, "slack.post_message", {
      channel: "C-eng-updates",
      text: "ENG-42 (checkout times out on retry) is in review; fix expected Thursday.",
    });
    expect(permitted(r)).toBe(true);
  });

  it("still refuses another channel", async () => {
    const r = await authorize(
      "slack agent-written text, other channel",
      "unauthorized",
      token,
      taskId,
      "slack.post_message",
      { channel: "C-general", text: "ENG-42 is in review." },
    );
    expect(r.body.status).toBe("deny");
  });

  it("refuses a second post once the step's single invocation is spent", async () => {
    const r = await authorize(
      "slack agent-written text, over budget",
      "unauthorized",
      token,
      taskId,
      "slack.post_message",
      { channel: "C-eng-updates", text: "One more update." },
    );
    expect(r.body.status).toBe("deny");
    expect(r.body.reasonCodes).toContain("INVOCATION_LIMIT_REACHED");
  });
});

describe("plans Authority cannot enforce are refused at prepare", () => {
  it("reports a step whose required free text (Slack `text`) is left for the agent to write", async () => {
    const { prepared } = await newTask("Post a status update to #ops.", [
      {
        id: "post",
        sequence: 1,
        tool: "slack.post_message",
        arguments: { channel: "C-ops" },
        expectedSideEffect: "write_create",
      },
    ]);
    // Nothing is left to compile, so prepare asks for clarification and names the excluded step.
    expect(prepared.body.status).toBe("clarification");
    const excluded = (prepared.body.details as { excludedSteps: Array<{ nodeId: string; status: string }> })
      .excludedSteps;
    expect(excluded).toEqual([expect.objectContaining({ nodeId: "post", status: "clarify" })]);
  });

  it("excludes a step whose channel would come from an earlier step's output", async () => {
    const { prepared } = await newTask("Read message m1 and reply in its channel.", [
      {
        id: "read",
        sequence: 1,
        tool: "gmail.get_message",
        arguments: { message_id: "m1" },
        declaredOutputs: ["channel"],
        expectedSideEffect: "read",
      },
      {
        id: "post",
        sequence: 2,
        tool: "slack.post_message",
        arguments: { text: "Reply" },
        dataFlowRefs: [{ argumentKey: "channel", fromNodeId: "read", output: "channel" }],
        expectedSideEffect: "write_create",
      },
    ]);
    const excluded = (prepared.body.excludedSteps ??
      (prepared.body.details as { excludedSteps?: unknown[] })?.excludedSteps) as Array<{
      nodeId: string;
      status: string;
    }>;
    expect(excluded).toEqual([expect.objectContaining({ nodeId: "post", status: "replan" })]);
  });
});

describe("credentials and sessions", () => {
  let taskId = "";
  beforeAll(async () => {
    taskId = (await newTask("Post the status to #ops.", [SLACK])).taskId;
  });

  it("refuses a raw runtime key when the application requires task sessions", async () => {
    const r = await authorize("raw runtime key", "unauthorized", keys.runtime, taskId, "slack.post_message", {
      channel: "C-ops",
      text: "Deployed.",
    });
    expect(r.http).toBe(403);
  });

  it("refuses a session minted for a different task", async () => {
    const other = (await newTask("Another task.", [SLACK])).taskId;
    const otherToken = (await sessionFor(other)).token;
    const r = await authorize(
      "session for another task",
      "unauthorized",
      otherToken,
      taskId,
      "slack.post_message",
      { channel: "C-ops", text: "Deployed." },
    );
    expect(r.http).toBe(403);
  });

  it("refuses a revoked session", async () => {
    const { token } = await sessionFor(taskId);
    expect((await call("revoke", "/api/v1/sessions/revoke", token, { reason: "evaluation" })).http).toBe(200);
    const r = await authorize("revoked session", "unauthorized", token, taskId, "slack.post_message", {
      channel: "C-ops",
      text: "Deployed.",
    });
    expect(r.http).toBe(401);
  });

  it("refuses an expired session", async () => {
    const { token, sessionId } = await sessionFor(taskId);
    await db.query(
      `update public.task_sessions set issued_at = now() - interval '10 minutes', expires_at = now() - interval '1 minute' where id = $1`,
      [sessionId],
    );
    const r = await authorize("expired session", "unauthorized", token, taskId, "slack.post_message", {
      channel: "C-ops",
      text: "Deployed.",
    });
    expect(r.http).toBe(401);
  });

  it("refuses a task under another application's customer", async () => {
    const r = await call(
      "tasks",
      `/api/v1/customers/${ids.otherCustomer}/tasks`,
      keys.backend,
      { agentId: ids.agent, intent: "Cross-application task" },
      { customerId: ids.otherCustomer },
    );
    expect([403, 404]).toContain(r.http);
  });

  it("does not list a task's tools over MCP for an arbitrary bearer string", async () => {
    const req = new NextRequest(`http://localhost/api/mcp/tasks/${taskId}`, {
      method: "POST",
      headers: {
        authorization: "Bearer not-a-real-key",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const res = await routes.mcp(req, { params: Promise.resolve({ taskId }) });
    expect(res.status).toBe(401);
  });

  it("refuses new sessions once the runtime key is revoked", async () => {
    await owner.rpc("revoke_agent_credential", {
      p_credential_id: ids.runtimeCredential,
      p_reason: "evaluation",
    });
    const s = await call("sessions", "/api/v1/sessions", keys.runtime, { taskId });
    expect(s.http).toBe(401);
  });
});
