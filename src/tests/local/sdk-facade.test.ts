import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Authority, type TaskCallResult } from "../../../packages/authority-sdk/src";

import {
  configureLocalEnv,
  ControllableProvider,
  createLocalWorld,
  type Handler,
  type LocalWorld,
} from "./mock-provider-fixture";

/**
 * The SDK facade (`Authority.prepareTask`, the task handle, `task.call`) against Authority's REAL route handlers and a
 * throwaway LOCAL Supabase. The SDK's fetch is routed in-process to the handlers; the provider is the controllable mock
 * Custom API from mock-provider-fixture.ts. This checks what the unit tests cannot: that the server accepts exactly
 * what the SDK sends, and that every refusal and uncertain outcome comes back as its own status with no provider
 * request and no retry.
 */

const provider = new ControllableProvider();
let w: LocalWorld;
let authority: Authority;

const ROUTES: Array<[RegExp, string, string[]]> = [
  [/^\/api\/v1\/customers$/, "@/app/api/v1/customers/route", []],
  [
    /^\/api\/v1\/customers\/([^/]+)\/tasks$/,
    "@/app/api/v1/customers/[customerId]/tasks/route",
    ["customerId"],
  ],
  [/^\/api\/v1\/tasks\/([^/]+)\/prepare$/, "@/app/api/v1/tasks/[taskId]/prepare/route", ["taskId"]],
  [/^\/api\/v1\/tasks\/([^/]+)\/tools$/, "@/app/api/v1/tasks/[taskId]/tools/route", ["taskId"]],
  [/^\/api\/v1\/sessions$/, "@/app/api/v1/sessions/route", []],
  [/^\/api\/v1\/sessions\/revoke$/, "@/app/api/v1/sessions/revoke/route", []],
  [/^\/api\/v1\/authorize$/, "@/app/api/v1/authorize/route", []],
  [/^\/api\/v1\/execute$/, "@/app/api/v1/execute/route", []],
];

/** A fetch that dispatches to the route handlers in this process, so the SDK talks to the real server code. */
const requestLog: string[] = [];
async function inProcessFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method ?? "GET").toUpperCase();
  requestLog.push(`${method} ${url.pathname}`);
  for (const [pattern, modulePath, names] of ROUTES) {
    const match = pattern.exec(url.pathname);
    if (!match) continue;
    const handler = (await import(/* @vite-ignore */ modulePath))[method] as Handler | undefined;
    if (!handler) return new Response(null, { status: 405 });
    const params = Object.fromEntries(names.map((n, i) => [n, match[i + 1]]));
    const req = new NextRequest(url, {
      method,
      headers: init?.headers as HeadersInit,
      body: init?.body as BodyInit | undefined,
      signal: init?.signal ?? undefined,
    });
    return handler(req, { params: Promise.resolve(params) });
  }
  return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });
}

const read = (orderId: string) => ({
  tool: w.readTool,
  arguments: { orderId },
  expectedSideEffect: "read" as const,
  maxInvocations: 2,
});
const refund = (orderId: string, maxInvocations = 1) => ({
  tool: w.writeTool,
  arguments: { orderId },
  expectedSideEffect: "write_create" as const,
  maxInvocations,
});
let n = 0;
const key = (label: string) => `sdk-${label}-${Date.now()}-${++n}`;

/** The admin's explicit per-customer grant: what a real app does before a user's first task on this connection. */
const granted = new Set<string>();
async function grantAccess(userId: string) {
  if (granted.has(userId)) return;
  const { customerId } = await authority.backend.customers.ensure({ externalId: userId });
  const { data } = await w.owner.rpc("grant_connection_delegation", {
    p_connection_id: w.connectionId,
    p_customer_id: customerId,
  });
  expect(data).toBe("ok");
  granted.add(userId);
}

async function ready(actions: unknown[], userId = "sdk-user-1") {
  await grantAccess(userId);
  const run = await authority.prepareTask({
    userId,
    request: "Look up and refund an order",
    connections: { [w.connectorId]: w.connectionId },
    actions: actions as never,
    idempotencyKey: key("prepare"),
  });
  if (run.status !== "ready") throw new Error(`prepareTask: ${JSON.stringify(run)}`);
  return run;
}
const providerPaths = () => provider.requests.map((r) => r.url.pathname);

beforeAll(async () => {
  configureLocalEnv();
  const { createCustomApiConnector, defaultCustomApiConnectorDeps } =
    await import("@/lib/connectors/custom-api/connector");
  const { registerConnector, resetConnectorRegistryForTests } = await import("@/lib/connectors/registry");
  resetConnectorRegistryForTests();
  registerConnector(createCustomApiConnector({ ...defaultCustomApiConnectorDeps, fetch: provider.fetch }));
  w = await createLocalWorld("sdk-facade");
  authority = new Authority({
    baseUrl: "http://localhost",
    backendKey: w.backendKey,
    agentId: w.agentId,
    runtimeKey: w.runtimeKey,
    fetch: inProcessFetch as never,
  });
}, 120_000);

afterAll(async () => {
  provider.releaseAll();
  await w?.db.end();
});

describe("SDK facade against the real API", () => {
  it("a user nobody shared the connection with gets an error and no task handle", async () => {
    const before = provider.requests.length;
    await expect(
      authority.prepareTask({
        userId: "sdk-user-without-access",
        request: "Look up order 7000",
        connections: { [w.connectorId]: w.connectionId },
        actions: [read("7000")] as never,
      }),
    ).rejects.toThrow(/not delegated/);
    expect(provider.requests.length).toBe(before);
  });

  it("prepares a task the server accepts, and a call fills the pinned value from the task", async () => {
    const run = await ready([read("7001")]);
    const before = provider.requests.length;
    const result = await run.task.call(w.readTool, {}, { idempotencyKey: key("read") });
    expect(result.status).toBe("executed");
    expect(provider.requests.length).toBe(before + 1);
    expect(providerPaths().at(-1)).toBe("/v1/orders/7001");
    // Customer, task, prepare, session went to the server in that order, each once.
    expect(requestLog.slice(-7)).toEqual([
      "POST /api/v1/customers",
      expect.stringMatching(/^POST \/api\/v1\/customers\/.+\/tasks$/),
      expect.stringMatching(/^POST \/api\/v1\/tasks\/.+\/prepare$/),
      "POST /api/v1/sessions",
      expect.stringMatching(/^GET \/api\/v1\/tasks\/.+\/tools$/),
      "POST /api/v1/authorize",
      "POST /api/v1/execute",
    ]);
  });

  it("refuses a wrong destination and an extra argument, with no provider request", async () => {
    const run = await ready([read("7002"), refund("7002")]);
    const before = provider.requests.length;
    const wrong = await run.task.call(w.writeTool, { orderId: "9999" }, { idempotencyKey: key("wrong") });
    const extra = await run.task.call(w.readTool, { bogus: "1" }, { idempotencyKey: key("extra") });
    expect(wrong.status).toBe("denied");
    expect(wrong.reasonCodes).toContain("CONSTRAINT_VIOLATION");
    expect(extra.status).toBe("denied");
    expect(provider.requests.length).toBe(before);
  });

  it("a repeated idempotency key never runs the action twice", async () => {
    const run = await ready([refund("7003", 2)]);
    const k = key("dup");
    const first = await run.task.call(w.writeTool, {}, { idempotencyKey: k });
    expect(first.status).toBe("executed");
    const before = provider.requests.length;
    const again = await run.task.call(w.writeTool, {}, { idempotencyKey: k });
    expect(["executed", "already_authorized"]).toContain(again.status);
    if (again.status === "executed") expect(again.replayed).toBe(true);
    expect(provider.requests.length).toBe(before);
  });

  it("two tasks prepared at once stay separate: each handle only reaches its own order", async () => {
    const [a, b] = await Promise.all([
      ready([refund("7101")], "sdk-user-a"),
      ready([refund("7102")], "sdk-user-b"),
    ]);
    expect(a.task.taskId).not.toBe(b.task.taskId);
    const [ra, rb] = await Promise.all([
      a.task.call(w.writeTool, {}, { idempotencyKey: key("a") }),
      b.task.call(w.writeTool, {}, { idempotencyKey: key("b") }),
    ]);
    expect([ra.status, rb.status]).toEqual(["executed", "executed"]);
    expect(providerPaths()).toEqual(
      expect.arrayContaining(["/v1/orders/7101/refunds", "/v1/orders/7102/refunds"]),
    );
    const before = provider.requests.length;
    const cross = await a.task.call(w.writeTool, { orderId: "7102" }, { idempotencyKey: key("cross") });
    expect(cross.status).toBe("denied");
    expect(provider.requests.length).toBe(before);
    expect(Object.isFrozen(a.task)).toBe(true);
  });

  it("a session the server has expired is reported as session_expired, not retried", async () => {
    const run = await ready([read("7004")]);
    await w.db.query(
      `update public.task_sessions
          set issued_at = now() - interval '2 minutes', expires_at = now() - interval '1 second'
        where id = $1`,
      [run.task.sessionId],
    );
    const before = provider.requests.length;
    const result = await run.task.call(w.readTool, {}, { idempotencyKey: key("expired") });
    expect(result.status).toBe("session_expired");
    expect(provider.requests.length).toBe(before);
  });

  it("re-preparing the task makes the old handle stale; a new handle works", async () => {
    const run = await ready([read("7005")]);
    const plan = {
      schemaVersion: 1 as const,
      taskId: run.task.taskId,
      nodes: [
        {
          id: "a1",
          sequence: 0,
          tool: w.readTool,
          arguments: { orderId: "7005" },
          dependencies: [],
          declaredOutputs: [],
          dataFlowRefs: [],
          expectedSideEffect: "read" as const,
          maxInvocations: 3,
        },
      ],
    };
    const again = await authority.backend.tasks.prepare(run.task.taskId, { plan }, key("reprepare"));
    expect(again.status).toBe("ready");
    const before = provider.requests.length;
    const stale = await run.task.call(w.readTool, {}, { idempotencyKey: key("stale") });
    expect(stale.status).toBe("stale_session");
    expect(provider.requests.length).toBe(before);
    const fresh = await authority.openTask(run.task.taskId);
    expect((await fresh.call(w.readTool, {}, { idempotencyKey: key("fresh") })).status).toBe("executed");
  });

  it("a plan the server only partly accepts gives no ready handle", async () => {
    await grantAccess("sdk-user-1");
    const run = await authority.prepareTask({
      userId: "sdk-user-1",
      request: "Look up an order and refund whatever the agent picks",
      connections: { [w.connectorId]: w.connectionId },
      actions: [read("7006"), { ...refund("7006"), arguments: {}, agentGenerated: ["orderId"] }] as never,
      idempotencyKey: key("partial"),
    });
    expect(run.status).toBe("partial");
    expect("task" in run).toBe(false);
  });

  it("a write that needs a person's approval is held at the call, with no dispatch, and stays held", async () => {
    const op = await w.db.query<{ id: string }>(
      `select id from public.custom_operation_definitions where connection_id = $1 and operation_slug = 'create_refund'`,
      [w.connectionId],
    );
    const setAutoExecute = (enabled: boolean) =>
      w.owner.rpc("set_custom_operation_auto_execute", {
        p_application_id: w.appId,
        p_operation_definition_id: op.rows[0].id,
        p_enabled: enabled,
        p_note: "sdk-facade approval test",
      });
    await setAutoExecute(false);
    try {
      const run = await ready([refund("7007")]);
      const before = provider.requests.length;
      const k = key("approval");
      const first = await run.task.call(w.writeTool, {}, { idempotencyKey: k });
      expect(first.status).toBe("requires_approval");
      const again = await run.task.call(w.writeTool, {}, { idempotencyKey: k });
      expect(again.status).toBe("requires_approval");
      expect(provider.requests.length).toBe(before);
    } finally {
      await setAutoExecute(true);
    }
  });

  it("a write whose provider response is lost is indeterminate and is never replayed", async () => {
    const run = await ready([refund("7008", 2)]);
    const k = key("uncertain");
    provider.mode = "transport_error";
    let first: TaskCallResult;
    try {
      const before = provider.requests.length;
      first = await run.task.call(w.writeTool, {}, { idempotencyKey: k });
      expect(provider.requests.length).toBe(before + 1);
    } finally {
      provider.mode = "succeed";
    }
    expect(first.status).toBe("indeterminate");
    const before = provider.requests.length;
    const again = await run.task.call(w.writeTool, {}, { idempotencyKey: k });
    expect(again.status).not.toBe("executed");
    expect(provider.requests.length).toBe(before);
  });
});
