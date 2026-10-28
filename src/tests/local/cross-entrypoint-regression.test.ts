import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
 * The same boundary through every agent-facing entrypoint: REST (`/authorize`, `/execute`, `/tools`) and MCP
 * (`tools/list`, `tools/call`). Throwaway local Supabase; the provider is the controllable mock in
 * mock-provider-fixture.ts, so "executed" below means "reached the mock", never a real provider.
 */

configureLocalEnv();
const provider = new ControllableProvider();
let world: LocalWorld;
let routes: Awaited<ReturnType<typeof loadRoutes>>;

const node = (orderId: string, maxInvocations: number) => ({
  id: "read",
  sequence: 1,
  tool: "", // filled in once the tool name is known
  arguments: { orderId },
  resourceBinding: orderId,
  expectedSideEffect: "read",
  maxInvocations,
});

async function mcp(taskId: string, token: string, method: string, params: Record<string, unknown> = {}) {
  return request(
    routes.mcp,
    `/api/mcp/tasks/${taskId}`,
    token,
    { jsonrpc: "2.0", id: 1, method, params },
    { taskId },
    { accept: "application/json, text/event-stream" },
  );
}
const mcpCallRefused = (r: { http: number; body: Record<string, unknown> }) =>
  r.http >= 400 ||
  Boolean((r.body.result as { isError?: boolean } | undefined)?.isError) ||
  Boolean(r.body.error);

async function restCall(taskId: string, token: string, args: Record<string, unknown>) {
  const auth = await request(routes.authorize, "/api/v1/authorize", token, {
    taskId,
    tool: world.readTool,
    operation: "get_order",
    arguments: args,
    idempotencyKey: `a-${Math.random()}`,
  });
  const cap = (auth.body.capability as { token?: string } | null)?.token;
  if (!cap) return { auth, exec: null };
  const exec = await request(routes.execute, "/api/v1/execute", token, {
    capability: cap,
    tool: world.readTool,
    operation: "get_order",
    arguments: args,
    idempotencyKey: `e-${Math.random()}`,
  });
  return { auth, exec };
}

let a: { taskId: string; token: string };
let b: { taskId: string; token: string };

beforeAll(async () => {
  const { createCustomApiConnector, defaultCustomApiConnectorDeps } =
    await import("@/lib/connectors/custom-api/connector");
  const { registerConnector, resetConnectorRegistryForTests } = await import("@/lib/connectors/registry");
  resetConnectorRegistryForTests();
  registerConnector(createCustomApiConnector({ ...defaultCustomApiConnectorDeps, fetch: provider.fetch }));
  world = await createLocalWorld("xentry");
  routes = await loadRoutes();
  a = await preparedTask(world, [{ ...node("4821", 3), tool: world.readTool }]);
  b = await preparedTask(world, [{ ...node("9999", 3), tool: world.readTool }], "Look up order 9999");
}, 180_000);

afterAll(async () => {
  await world?.db.end();
});

describe("authentication, on every entrypoint", () => {
  it("refuses an arbitrary bearer string and never reaches the provider", async () => {
    const before = provider.requests.length;
    expect(
      (
        await request(routes.authorize, "/api/v1/authorize", "not-a-key", {
          taskId: a.taskId,
          tool: world.readTool,
          operation: "get_order",
          arguments: { orderId: "4821" },
          idempotencyKey: "x",
        })
      ).http,
    ).toBe(401);
    expect(
      (
        await request(routes.tools, `/api/v1/tasks/${a.taskId}/tools`, "not-a-key", undefined, {
          taskId: a.taskId,
        })
      ).http,
    ).toBe(401);
    expect((await mcp(a.taskId, "not-a-key", "tools/list")).http).toBe(401);
    expect(
      (
        await mcp(a.taskId, "not-a-key", "tools/call", {
          name: world.readTool,
          arguments: { orderId: "4821" },
        })
      ).http,
    ).toBe(401);
    expect(provider.requests.length).toBe(before);
  });
});

describe("task isolation, on every entrypoint", () => {
  it("refuses task A's session on task B (REST and MCP) and never reaches the provider", async () => {
    const before = provider.requests.length;
    expect((await restCall(b.taskId, a.token, { orderId: "9999" })).auth.http).toBe(403);
    expect(
      (
        await request(routes.tools, `/api/v1/tasks/${b.taskId}/tools`, a.token, undefined, {
          taskId: b.taskId,
        })
      ).http,
    ).toBe(403);
    expect((await mcp(b.taskId, a.token, "tools/list")).http).toBe(403);
    expect(
      (await mcp(b.taskId, a.token, "tools/call", { name: world.readTool, arguments: { orderId: "9999" } }))
        .http,
    ).toBe(403);
    expect(provider.requests.length).toBe(before);
  });

  it("refuses another order on task A (REST and MCP)", async () => {
    const before = provider.requests.length;
    expect(["deny", "replan"]).toContain(
      (await restCall(a.taskId, a.token, { orderId: "9999" })).auth.body.status,
    );
    expect(
      mcpCallRefused(
        await mcp(a.taskId, a.token, "tools/call", { name: world.readTool, arguments: { orderId: "9999" } }),
      ),
    ).toBe(true);
    expect(provider.requests.length).toBe(before);
  });
});

describe("extra arguments, on every entrypoint", () => {
  it("refuses a declared but unpinned argument (REST and MCP), with no provider request", async () => {
    const before = provider.requests.length;
    expect(
      (await restCall(a.taskId, a.token, { orderId: "4821", expand: "customer" })).auth.body.status,
    ).toBe("deny");
    expect(
      mcpCallRefused(
        await mcp(a.taskId, a.token, "tools/call", {
          name: world.readTool,
          arguments: { orderId: "4821", expand: "customer" },
        }),
      ),
    ).toBe(true);
    expect(provider.requests.length).toBe(before);
  });

  it("REST refuses an argument the operation does not have", async () => {
    expect((await restCall(a.taskId, a.token, { orderId: "4821", admin: "true" })).auth.body.status).toBe(
      "deny",
    );
  });

  it("MCP refuses an argument the operation does not have, like REST, and it never reaches the provider", async () => {
    const before = provider.requests.length;
    const r = await mcp(a.taskId, a.token, "tools/call", {
      name: world.readTool,
      arguments: { orderId: "4821", admin: "true" },
    });
    expect(mcpCallRefused(r)).toBe(true);
    expect(JSON.stringify(r.body)).toContain("CONSTRAINT_VIOLATION");
    expect(provider.requests.length).toBe(before);
  });

  it("MCP refuses an extra key whose value is not an argument value (an object) before authorization", async () => {
    const before = provider.requests.length;
    const r = await mcp(a.taskId, a.token, "tools/call", {
      name: world.readTool,
      arguments: { orderId: "4821", admin: { role: "owner" } },
    });
    expect(mcpCallRefused(r)).toBe(true);
    expect(provider.requests.length).toBe(before);
  });
});

describe("budget enforcement, shared across entrypoints", () => {
  it("counts REST and MCP calls against the same action budget", async () => {
    const c = await preparedTask(world, [{ ...node("7000", 2), tool: world.readTool }], "Look up order 7000");
    const first = await restCall(c.taskId, c.token, { orderId: "7000" });
    expect(first.exec?.http).toBe(200);
    const second = await mcp(c.taskId, c.token, "tools/call", {
      name: world.readTool,
      arguments: { orderId: "7000" },
    });
    expect(mcpCallRefused(second)).toBe(false);
    const sent = provider.requests.length;
    const thirdMcp = await mcp(c.taskId, c.token, "tools/call", {
      name: world.readTool,
      arguments: { orderId: "7000" },
    });
    expect(mcpCallRefused(thirdMcp)).toBe(true);
    expect(provider.requests.length).toBe(sent);
    const thirdRest = await restCall(c.taskId, c.token, { orderId: "7000" });
    expect(thirdRest.auth.body.reasonCodes).toContain("INVOCATION_LIMIT_REACHED");
  });
});
