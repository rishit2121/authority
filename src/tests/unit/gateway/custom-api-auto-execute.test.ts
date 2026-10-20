import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as PipelineModule from "@/lib/gateway/pipeline";
import type * as RpcModule from "@/lib/gateway/rpc";
import type { LoadedRegistry } from "@/lib/registry";
import type { ToolOperation } from "@/lib/registry/types";

/**
 * Per-application opt-in for automatic execution of published Custom API writes.
 * Only the registry-default hold is lifted, only for opted-in tools of the task's own application.
 */

const authorizeThroughGateway = vi.fn();
const tenantForTask = vi.fn();
const autoExecuteToolsForTask = vi.fn();
const buildTenantRegistry = vi.fn();

vi.mock("@/lib/gateway/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof PipelineModule>();
  return { ...actual, authorizeThroughGateway };
});
vi.mock("@/lib/gateway/rpc", async (importOriginal) => {
  const actual = await importOriginal<typeof RpcModule>();
  return { ...actual, tenantForTask, autoExecuteToolsForTask };
});
vi.mock("@/lib/registry", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, buildTenantRegistry: (...a: unknown[]) => buildTenantRegistry(...a) };
});

const { registryRequiresApprovalWithOptIn } = await import("@/lib/gateway/risk-class");
const { POST: authorize } = await import("@/app/api/v1/authorize/route");

const WRITE = "custom_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.post_message";
const OTHER_WRITE = "custom_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.send_email";
const READ = "custom_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.read_email";

function op(id: string, requiresApproval: boolean): ToolOperation {
  return {
    id,
    provider: "custom_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sideEffect: requiresApproval ? "write_create" : "read",
    resourceType: "x",
    dataSensitivity: "confidential",
    externalCommunication: requiresApproval,
    requiresApproval,
    financialImpact: false,
    argumentFields: [{ key: "channel", type: "string", required: true, identifiesResource: true }],
    preconditions: [],
    effects: [],
    alternativeOperationIds: [],
  };
}
const registry = {
  registryVersion: "test",
  operations: new Map([
    [WRITE, op(WRITE, true)],
    [OTHER_WRITE, op(OTHER_WRITE, true)],
    [READ, op(READ, false)],
  ]),
} as unknown as LoadedRegistry;

describe("registryRequiresApprovalWithOptIn", () => {
  it("keeps the default hold for every write that is not opted in", () => {
    expect(registryRequiresApprovalWithOptIn(registry, WRITE, new Set())).toBe(true);
    expect(registryRequiresApprovalWithOptIn(registry, OTHER_WRITE, new Set([WRITE]))).toBe(true);
  });
  it("lifts only the registry hold, only for the exact opted-in tool", () => {
    expect(registryRequiresApprovalWithOptIn(registry, WRITE, new Set([WRITE]))).toBe(false);
  });
  it("never adds a hold: tools that did not require approval are unchanged", () => {
    expect(registryRequiresApprovalWithOptIn(registry, READ, new Set())).toBe(false);
    expect(registryRequiresApprovalWithOptIn(registry, "unknown.tool", new Set(["unknown.tool"]))).toBe(
      false,
    );
  });
});

describe("POST /api/v1/authorize wiring", () => {
  const TASK = "00000000-0000-4000-8000-000000000001";
  const body = (tool: string) => ({
    taskId: TASK,
    tool,
    operation: tool.split(".")[1],
    resource: "#ops",
    idempotencyKey: "k1",
    arguments: { channel: "#ops" },
  });
  const req = (b: unknown) =>
    new NextRequest("http://localhost/api/v1/authorize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer authority_ts_${"ab".repeat(32)}`,
      },
      body: JSON.stringify(b),
    });

  beforeEach(() => {
    authorizeThroughGateway.mockReset().mockResolvedValue({ kind: "failure", status: "task_not_found" });
    tenantForTask.mockReset().mockResolvedValue("tenant-a");
    buildTenantRegistry.mockReset().mockResolvedValue(registry);
    autoExecuteToolsForTask.mockReset();
  });

  it("passes the task's application opt-in to the pipeline, for that tool only", async () => {
    autoExecuteToolsForTask.mockResolvedValue(new Set([WRITE]));
    await authorize(req(body(WRITE)));
    expect(autoExecuteToolsForTask).toHaveBeenCalledWith(TASK);
    const deps = authorizeThroughGateway.mock.calls[0][1] as typeof PipelineModule.defaultPipelineDeps;
    expect(deps.registryRequiresApproval(WRITE)).toBe(false);
    expect(deps.registryRequiresApproval(OTHER_WRITE)).toBe(true);
  });

  it("preserves the default hold for applications that have not opted in", async () => {
    autoExecuteToolsForTask.mockResolvedValue(new Set());
    await authorize(req(body(WRITE)));
    const deps = authorizeThroughGateway.mock.calls[0][1] as typeof PipelineModule.defaultPipelineDeps;
    expect(deps.registryRequiresApproval(WRITE)).toBe(true);
  });

  it("does not look up an opt-in when the task's tenant cannot be resolved", async () => {
    tenantForTask.mockResolvedValue(null);
    await authorize(req(body(WRITE)));
    expect(autoExecuteToolsForTask).not.toHaveBeenCalled();
  });
});
