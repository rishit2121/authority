import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ADMIN_A_USER_ID,
  configureLocalEnv,
  ControllableProvider,
  createLocalWorld,
  loadRoutes,
  preparedTask,
  request,
  TENANT_A_ID,
  type LocalWorld,
} from "./mock-provider-fixture";

/**
 * Execution and disconnect races against a CONTROLLABLE MOCK provider (mock-provider-fixture.ts): a request can be
 * held in flight, failed, or counted, and the database is a throwaway local Supabase. This verifies Authority's own
 * reservation, dispatch, settlement and accounting under those timings. It is NOT real-provider verification: how a
 * real provider behaves on a dropped connection, a timeout or a duplicate request is not tested here.
 */

configureLocalEnv();
const provider = new ControllableProvider();
let routes: Awaited<ReturnType<typeof loadRoutes>>;
const worlds: LocalWorld[] = [];

async function world(label: string) {
  const w = await createLocalWorld(label);
  worlds.push(w);
  return w;
}
const writeNode = (w: LocalWorld, orderId: string) => ({
  id: "refund",
  sequence: 1,
  tool: w.writeTool,
  arguments: { orderId },
  resourceBinding: orderId,
  expectedSideEffect: "write_create",
  maxInvocations: 1,
});
const readNode = (w: LocalWorld, orderId: string, maxInvocations = 1) => ({
  id: "read",
  sequence: 1,
  tool: w.readTool,
  arguments: { orderId },
  resourceBinding: orderId,
  expectedSideEffect: "read",
  maxInvocations,
});

async function authorize(
  w: LocalWorld,
  t: { taskId: string; token: string },
  tool: string,
  args: Record<string, unknown>,
) {
  const r = await request(routes.authorize, "/api/v1/authorize", t.token, {
    taskId: t.taskId,
    tool,
    operation: tool.split(".")[1],
    arguments: args,
    idempotencyKey: `a-${Math.random()}`,
  });
  const cap = r.body.capability as { id: string; token: string } | null;
  if (!cap?.token) throw new Error(`authorize: ${JSON.stringify(r.body)}`);
  return cap;
}
const execute = (
  t: { token: string },
  cap: { token: string },
  tool: string,
  args: Record<string, unknown>,
  key = `e-${Math.random()}`,
) =>
  request(routes.execute, "/api/v1/execute", t.token, {
    capability: cap.token,
    tool,
    operation: tool.split(".")[1],
    arguments: args,
    idempotencyKey: key,
  });

async function disconnect(w: LocalWorld) {
  const { disconnectConnectorConnection } = await import("@/lib/gateway/rpc-connectors");
  const r = await disconnectConnectorConnection({
    tenantId: TENANT_A_ID,
    userId: ADMIN_A_USER_ID,
    connectionId: w.connectionId,
  });
  if (r.status !== "ok") throw new Error(`disconnect: ${r.status}`);
}
const capabilityRow = async (w: LocalWorld, id: string) =>
  (await w.db.query(`select status, uses, reserved_uses from public.capability_tokens where id = $1`, [id]))
    .rows[0];
const reservationsFor = async (w: LocalWorld, id: string) =>
  (
    await w.db.query(
      `select status, reason_code from public.connector_reservations where capability_id = $1 order by reserved_at`,
      [id],
    )
  ).rows;
const receiptsFor = async (w: LocalWorld, id: string) =>
  (
    await w.db.query(
      `select result_category from public.connector_execution_receipts where capability_id = $1`,
      [id],
    )
  ).rows.map((r) => r.result_category);

const observed: Record<string, unknown> = {};

beforeAll(async () => {
  const { createCustomApiConnector, defaultCustomApiConnectorDeps } =
    await import("@/lib/connectors/custom-api/connector");
  const { registerConnector, resetConnectorRegistryForTests } = await import("@/lib/connectors/registry");
  resetConnectorRegistryForTests();
  registerConnector(createCustomApiConnector({ ...defaultCustomApiConnectorDeps, fetch: provider.fetch }));
  routes = await loadRoutes();
}, 60_000);

afterAll(async () => {
  provider.releaseAll();
  console.log("EXECUTION-RACES (mock provider, not a real provider) " + JSON.stringify(observed));
  for (const w of worlds) await w.db.end();
});

describe("disconnect races (mock provider)", () => {
  it("a write already in flight when the connection is disconnected keeps its provider outcome on record", async () => {
    const w = await world("race-inflight");
    const t = await preparedTask(w, [writeNode(w, "1001")], "Refund order 1001");
    const cap = await authorize(w, t, w.writeTool, { orderId: "1001" });
    provider.mode = "hold";
    const before = provider.requests.length;
    const pending = execute(t, cap, w.writeTool, { orderId: "1001" });
    await provider.waitForRequests(before + 1);
    await disconnect(w);
    provider.mode = "succeed";
    provider.releaseAll();
    const result = await pending;
    observed.inflightDisconnect = {
      http: result.http,
      result: result.body.result,
      receipts: await receiptsFor(w, cap.id),
      capability: await capabilityRow(w, cap.id),
    };
    // The provider received the write, so the receipt must say what happened rather than pretend it did not.
    expect(provider.requests.length).toBe(before + 1);
    expect(await receiptsFor(w, cap.id)).toHaveLength(1);
    expect(["succeeded", "indeterminate"]).toContain((await receiptsFor(w, cap.id))[0]);
  });

  it("a capability authorized before a disconnect is never dispatched after it, and its use is not spent", async () => {
    const w = await world("race-predispatch");
    const t = await preparedTask(w, [writeNode(w, "2002")], "Refund order 2002");
    const cap = await authorize(w, t, w.writeTool, { orderId: "2002" });
    await disconnect(w);
    const before = provider.requests.length;
    const result = await execute(t, cap, w.writeTool, { orderId: "2002" });
    observed.predispatchDisconnect = {
      http: result.http,
      error: result.body.error,
      capability: await capabilityRow(w, cap.id),
      reservations: await reservationsFor(w, cap.id),
    };
    expect(result.http).toBeGreaterThanOrEqual(400);
    expect(provider.requests.length).toBe(before);
    expect((await capabilityRow(w, cap.id)).uses).toBe(0);
  });
});

describe("concurrency races (mock provider)", () => {
  let w: LocalWorld;
  beforeAll(async () => {
    w = await world("race-concurrency");
  }, 120_000);

  it("two executions of one single-use capability at once reach the provider exactly once", async () => {
    const t = await preparedTask(w, [readNode(w, "3003")], "Look up order 3003");
    const cap = await authorize(w, t, w.readTool, { orderId: "3003" });
    provider.mode = "hold";
    const before = provider.requests.length;
    const first = execute(t, cap, w.readTool, { orderId: "3003" });
    const second = execute(t, cap, w.readTool, { orderId: "3003" });
    await provider.waitForRequests(before + 1);
    await new Promise((r) => setTimeout(r, 300));
    provider.mode = "succeed";
    provider.releaseAll();
    const results = await Promise.all([first, second]);
    observed.duplicateUse = results.map((r) => ({
      http: r.http,
      code: (r.body.error as { code?: string } | undefined)?.code ?? r.body.result,
    }));
    expect(provider.requests.length).toBe(before + 1);
    expect(results.filter((r) => r.http === 200)).toHaveLength(1);
  });

  it("the same idempotency key while in flight is not run twice, and replays afterwards", async () => {
    const t = await preparedTask(w, [readNode(w, "4004")], "Look up order 4004");
    const cap = await authorize(w, t, w.readTool, { orderId: "4004" });
    provider.mode = "hold";
    const before = provider.requests.length;
    const first = execute(t, cap, w.readTool, { orderId: "4004" }, "same-key");
    await provider.waitForRequests(before + 1);
    const during = await execute(t, cap, w.readTool, { orderId: "4004" }, "same-key");
    provider.mode = "succeed";
    provider.releaseAll();
    const done = await first;
    const after = await execute(t, cap, w.readTool, { orderId: "4004" }, "same-key");
    observed.sameKey = {
      during: during.http,
      done: done.http,
      after: { http: after.http, replayed: after.body.replayed },
    };
    expect(provider.requests.length).toBe(before + 1);
    expect(during.http).toBe(409);
    expect(after.body.replayed).toBe(true);
  });

  it("a write whose transport fails after dispatch is indeterminate, keeps its use held, and is never retried", async () => {
    const t = await preparedTask(w, [writeNode(w, "5005")], "Refund order 5005");
    const cap = await authorize(w, t, w.writeTool, { orderId: "5005" });
    provider.mode = "transport_error";
    const before = provider.requests.length;
    const result = await execute(t, cap, w.writeTool, { orderId: "5005" }, "k-5005");
    provider.mode = "succeed";
    const replay = await execute(t, cap, w.writeTool, { orderId: "5005" }, "k-5005");
    const row = await capabilityRow(w, cap.id);
    observed.transportFailure = {
      http: result.http,
      code: (result.body.error as { code?: string } | undefined)?.code,
      replay: { http: replay.http, status: replay.body.status },
      capability: row,
      reservations: await reservationsFor(w, cap.id),
    };
    expect(result.http).toBe(504);
    // Dispatched once; the outcome is unknown, so the use is neither refunded nor retried. It stays held by the
    // indeterminate reservation (reserved, not settled as spent), and the replay is refused.
    expect(provider.requests.length).toBe(before + 1);
    expect(row.uses + row.reserved_uses).toBe(1);
    expect(replay.http).toBe(409);
  });
});
