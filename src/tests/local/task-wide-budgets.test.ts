import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";

import { FIXTURE_PASSWORD, localSupabaseEnv } from "./local-env";
import {
  configureLocalEnv,
  ControllableProvider,
  createLocalWorld,
  loadRoutes,
  preparedTask,
  request,
  type LocalWorld,
} from "./mock-provider-fixture";

/**
 * Task-wide budgets (migration 20261027000001) through the real local API: an action's budget spans every contract
 * version of the task, re-preparing inherits it, and only the trusted backend (`raiseBudgets` on prepare) or an
 * admin can renew it. Legitimate completion and attempted bypasses side by side. The provider is the in-process mock.
 */

configureLocalEnv();
const provider = new ControllableProvider();
let routes: Awaited<ReturnType<typeof loadRoutes>>;
let w: LocalWorld;

const readNode = (w: LocalWorld, orderId: string, maxInvocations = 2) => ({
  id: "read",
  sequence: 1,
  tool: w.readTool,
  arguments: { orderId },
  resourceBinding: orderId,
  expectedSideEffect: "read",
  maxInvocations,
});

const prepare = (taskId: string, nodes: unknown[], extra: Record<string, unknown> = {}, key = w.backendKey) =>
  request(
    routes.prepare,
    `/api/v1/tasks/${taskId}/prepare`,
    key,
    { plan: { schemaVersion: 1, taskId, nodes }, ...extra },
    { taskId },
  );

/** Re-prepares, then opens a new task session when a new version is active: sessions are bound to one contract. */
async function reprepare(
  task: { taskId: string; token: string },
  nodes: unknown[],
  extra: Record<string, unknown> = {},
) {
  const r = await prepare(task.taskId, nodes, extra);
  if (r.body.status === "ready") {
    const session = await request(routes.sessions, "/api/v1/sessions", w.runtimeKey, { taskId: task.taskId });
    task.token = session.body.token as string;
  }
  return r;
}

let n = 0;
const authorize = (token: string, taskId: string, orderId: string) =>
  request(routes.authorize, "/api/v1/authorize", token, {
    taskId,
    tool: w.readTool,
    operation: w.readTool.split(".")[1],
    arguments: { orderId },
    idempotencyKey: `twb-${++n}-${Math.random()}`,
  });
const allowed = (r: { body: Record<string, unknown> }) =>
  ["allow", "allow_constrained"].includes(String(r.body.status));

async function remaining(token: string, taskId: string, orderId: string): Promise<number | null> {
  const r = await request(routes.tools, `/api/v1/tasks/${taskId}/tools`, token, undefined, { taskId });
  const tools = (r.body.tools ?? []) as Array<{
    tool: string;
    resourceConstraints: Array<{ key: string; equals?: string }>;
    remainingInvocations: number | null;
  }>;
  const entry = tools.find(
    (t) =>
      t.tool === w.readTool && t.resourceConstraints.some((c) => c.key === "orderId" && c.equals === orderId),
  );
  return entry?.remainingInvocations ?? null;
}

async function mcpCall(taskId: string, token: string, orderId: string) {
  const res = await request(
    routes.mcp,
    `/api/mcp/tasks/${taskId}`,
    token,
    {
      jsonrpc: "2.0",
      id: ++n,
      method: "tools/call",
      params: { name: w.readTool, arguments: { orderId } },
    },
    { taskId },
    { accept: "application/json, text/event-stream" },
  );
  const result = (res.body.result ?? {}) as { isError?: boolean; content?: Array<{ text?: string }> };
  return { refused: result.isError === true, text: (result.content ?? []).map((c) => c.text).join(" ") };
}

beforeAll(async () => {
  const { createCustomApiConnector, defaultCustomApiConnectorDeps } =
    await import("@/lib/connectors/custom-api/connector");
  const { registerConnector, resetConnectorRegistryForTests } = await import("@/lib/connectors/registry");
  resetConnectorRegistryForTests();
  registerConnector(createCustomApiConnector({ ...defaultCustomApiConnectorDeps, fetch: provider.fetch }));
  routes = await loadRoutes();
  w = await createLocalWorld("task-wide-budgets");
}, 120_000);

afterAll(async () => {
  provider.releaseAll();
  await w?.db.end();
});

describe("re-preparing inherits the task-wide budget", () => {
  let task: { taskId: string; token: string };

  beforeAll(async () => {
    task = await preparedTask(w, [readNode(w, "5101")], "Look up order 5101");
  });

  it("spends the version's budget as before, and the manifest counts down", async () => {
    expect(await remaining(task.token, task.taskId, "5101")).toBe(2);
    expect(allowed(await authorize(task.token, task.taskId, "5101"))).toBe(true);
    expect(allowed(await authorize(task.token, task.taskId, "5101"))).toBe(true);
    expect(await remaining(task.token, task.taskId, "5101")).toBe(0);
    const third = await authorize(task.token, task.taskId, "5101");
    expect(third.body.reasonCodes).toContain("INVOCATION_LIMIT_REACHED");
  });

  it("a re-prepare of the same plan inherits the spent budget instead of resetting it", async () => {
    const again = await reprepare(task, [readNode(w, "5101")]);
    expect(again.body.status).toBe("ready");
    expect(again.body.budgets).toBe("inherited");
    expect(await remaining(task.token, task.taskId, "5101")).toBe(0);
    const before = provider.requests.length;
    const r = await authorize(task.token, task.taskId, "5101");
    expect(r.body.status).toBe("deny");
    expect(r.body.reasonCodes).toContain("INVOCATION_LIMIT_REACHED");
    expect(provider.requests.length).toBe(before);
  });

  it("asking for more in a new version (maxInvocations 5) without a raise is still capped", async () => {
    const bigger = await reprepare(task, [readNode(w, "5101", 5)]);
    expect(bigger.body.budgets).toBe("inherited");
    expect(allowed(await authorize(task.token, task.taskId, "5101"))).toBe(false);
  });

  it("MCP draws on the same task-wide budget", async () => {
    const r = await mcpCall(task.taskId, task.token, "5101");
    expect(r.refused).toBe(true);
  });

  it("a runtime key or a task session cannot prepare with raiseBudgets", async () => {
    const asRuntime = await prepare(task.taskId, [readNode(w, "5101")], { raiseBudgets: true }, w.runtimeKey);
    const asSession = await prepare(task.taskId, [readNode(w, "5101")], { raiseBudgets: true }, task.token);
    expect(asRuntime.http).toBeGreaterThanOrEqual(400);
    expect(asSession.http).toBeGreaterThanOrEqual(400);
    expect(allowed(await authorize(task.token, task.taskId, "5101"))).toBe(false);
  });

  it("an authorize request cannot carry raiseBudgets", async () => {
    const r = await request(routes.authorize, "/api/v1/authorize", task.token, {
      taskId: task.taskId,
      tool: w.readTool,
      operation: w.readTool.split(".")[1],
      arguments: { orderId: "5101" },
      idempotencyKey: `twb-raise-${Math.random()}`,
      raiseBudgets: true,
    });
    expect(r.http).toBe(400);
  });

  it("the trusted backend's explicit raise renews it, once", async () => {
    const raised = await reprepare(task, [readNode(w, "5101")], { raiseBudgets: true });
    expect(raised.body.status).toBe("ready");
    expect(raised.body.budgets).toBe("raised");
    expect(await remaining(task.token, task.taskId, "5101")).toBe(2);
    expect(allowed(await authorize(task.token, task.taskId, "5101"))).toBe(true);
    expect(allowed(await authorize(task.token, task.taskId, "5101"))).toBe(true);
    expect(allowed(await authorize(task.token, task.taskId, "5101"))).toBe(false);
  });

  it("replaying a prepare with raiseBudgets does not raise again", async () => {
    const key = `twb-replay-${Math.random()}`;
    const first = await reprepare(task, [readNode(w, "5101")], { idempotencyKey: key });
    expect(first.body.budgets).toBe("inherited");
    const replay = await prepare(task.taskId, [readNode(w, "5101")], {
      idempotencyKey: key,
      raiseBudgets: true,
    });
    expect(replay.body.contractId).toBe(first.body.contractId);
    expect(replay.body.budgets).toBe("inherited");
    expect(allowed(await authorize(task.token, task.taskId, "5101"))).toBe(false);
  });

  it("a different pinned value is a different action with its own budget", async () => {
    const other = await reprepare(task, [readNode(w, "5102")]);
    expect(other.body.status).toBe("ready");
    expect(allowed(await authorize(task.token, task.taskId, "5102"))).toBe(true);
  });
});

describe("a person renews the budget", () => {
  let task: { taskId: string; token: string };

  // The case renewing is for: the task re-prepared (fresh per-version limits) but the inherited task-wide budget is
  // spent. Renewing raises the task-wide allowance; this version's own limits still apply.
  beforeAll(async () => {
    task = await preparedTask(w, [readNode(w, "5201", 1)], "Look up order 5201");
    expect(allowed(await authorize(task.token, task.taskId, "5201"))).toBe(true);
    const again = await reprepare(task, [readNode(w, "5201", 1)]);
    expect(again.body.budgets).toBe("inherited");
    expect(allowed(await authorize(task.token, task.taskId, "5201"))).toBe(false);
  });

  it("a developer cannot renew, and no client can write an allowance directly", async () => {
    const env = localSupabaseEnv();
    const dev = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } });
    const { error: signIn } = await dev.auth.signInWithPassword({
      email: "dev.a@authority.test",
      password: FIXTURE_PASSWORD,
    });
    expect(signIn).toBeNull();
    const { data } = await dev.rpc("raise_task_budgets", { p_task_id: task.taskId, p_note: "please" });
    expect(data).toBe("forbidden");
    const { error: insertError } = await dev.from("task_action_allowances").insert({
      tenant_id: "11111111-1111-4111-8111-111111111111",
      task_id: task.taskId,
      tool: w.readTool,
      resource_constraints: { schemaVersion: 1, items: [] },
      allowance: 99,
    });
    expect(insertError).not.toBeNull();
    const { error: updateError, count } = await w.owner
      .from("task_action_allowances")
      .update({ allowance: 99 }, { count: "exact" })
      .eq("task_id", task.taskId);
    expect(updateError !== null || count === 0).toBe(true);
    expect(allowed(await authorize(task.token, task.taskId, "5201"))).toBe(false);
  });

  it("an owner can, and it is recorded", async () => {
    const { data, error } = await w.owner.rpc("raise_task_budgets", {
      p_task_id: task.taskId,
      p_note: "customer asked for one more lookup",
    });
    expect(error).toBeNull();
    expect(data).toBe("ok");
    expect(allowed(await authorize(task.token, task.taskId, "5201"))).toBe(true);
    expect(allowed(await authorize(task.token, task.taskId, "5201"))).toBe(false);
    const audit = await w.db.query(
      `select actor_kind, note from public.task_budget_changes where task_id = $1 and change = 'raised'`,
      [task.taskId],
    );
    expect(audit.rows).toEqual([{ actor_kind: "person", note: "customer asked for one more lookup" }]);
  });
});

describe("concurrency", () => {
  it("authorizations racing a re-prepare, then under the new version, never exceed the task-wide allowance", async () => {
    const task = await preparedTask(w, [readNode(w, "5301", 3)], "Look up order 5301");
    const firstToken = task.token;
    const raced = await Promise.all([
      ...Array.from({ length: 6 }, () => authorize(firstToken, task.taskId, "5301")),
      prepare(task.taskId, [readNode(w, "5301", 3)]),
      ...Array.from({ length: 6 }, () => authorize(firstToken, task.taskId, "5301")),
    ]);
    expect(raced[6].body.budgets).toBe("inherited");
    const session = await request(routes.sessions, "/api/v1/sessions", w.runtimeKey, { taskId: task.taskId });
    const later = await Promise.all(
      Array.from({ length: 3 }, () => authorize(session.body.token as string, task.taskId, "5301")),
    );
    const allowedCount = [...raced.filter((_, i) => i !== 6), ...later].filter(allowed).length;
    expect(allowedCount).toBeLessThanOrEqual(3);
    const used = await w.db.query(
      `select coalesce(sum(consumed_uses), 0)::int as used from public.capabilities where task_id = $1`,
      [task.taskId],
    );
    expect(used.rows[0].used).toBe(allowedCount);
  });
});
