import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MCP discovery used to need only *some* bearer string: the route built and served this task's tool catalog (its
 * active contract, including a tenant's own published operations) before any credential check, and its responses
 * told a missing task apart from one without a contract. It now applies the same check as REST /tools first.
 */

const catalog = vi.fn();
const resolveCredential = vi.fn();
const tenantForTask = vi.fn();

vi.mock("@/lib/mcp/bridge", () => ({
  buildMcpToolCatalog: (...args: unknown[]) => catalog(...args),
  authorizeAndExecuteMcpTool: vi.fn(),
}));
vi.mock("@/lib/gateway/rpc-sessions", () => ({
  resolveCredential: (...args: unknown[]) => resolveCredential(...args),
  taskSessionInfo: vi.fn(),
}));
vi.mock("@/lib/gateway/rpc", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  tenantForTask: (...args: unknown[]) => tenantForTask(...args),
  taskCredentialPolicy: vi.fn(async () => "ok"),
}));

import { POST } from "@/app/api/mcp/tasks/[taskId]/route";

const TASK = "11111111-2222-4333-8444-555555555555";
const listTools = (bearer: string) =>
  POST(
    new NextRequest(`http://localhost/api/mcp/tasks/${TASK}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
    { params: Promise.resolve({ taskId: TASK }) },
  );

beforeEach(() => {
  catalog.mockReset().mockResolvedValue({ status: "ok", tools: [] });
  resolveCredential.mockReset();
  tenantForTask.mockReset().mockResolvedValue("tenant-a");
});

describe("MCP discovery requires a credential for this task", () => {
  it("refuses an arbitrary bearer string without reading the task", async () => {
    resolveCredential.mockResolvedValue({ status: "invalid_credential", tenantId: null });
    const res = await listTools("not-a-real-key");
    expect(res.status).toBe(401);
    expect(catalog).not.toHaveBeenCalled();
  });

  it("reports another tenant's task exactly like a missing one", async () => {
    resolveCredential.mockResolvedValue({ status: "ok", tenantId: "tenant-b" });
    const res = await listTools("authority_rk_other_tenant");
    expect(res.status).toBe(404);
    expect(catalog).not.toHaveBeenCalled();
  });

  it("serves the catalog to a credential of the owning tenant", async () => {
    resolveCredential.mockResolvedValue({ status: "ok", tenantId: "tenant-a" });
    await listTools("authority_rk_owner");
    expect(catalog).toHaveBeenCalledWith(TASK);
  });
});
