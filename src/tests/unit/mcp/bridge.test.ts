import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantForTask = vi.fn();
const activeContractForTask = vi.fn();
const buildTenantRegistry = vi.fn();

vi.mock("@/lib/gateway/rpc", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    tenantForTask: (...args: unknown[]) => tenantForTask(...args),
    activeContractForTask: (...args: unknown[]) => activeContractForTask(...args),
  };
});
vi.mock("@/lib/registry", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, buildTenantRegistry: (...args: unknown[]) => buildTenantRegistry(...args) };
});

import { buildMcpToolCatalog } from "@/lib/mcp/bridge";
import type { ToolOperation } from "@/lib/registry/types";

function op(over: Partial<ToolOperation> = {}): ToolOperation {
  return {
    id: "stripe.retrieve_payment",
    provider: "stripe",
    sideEffect: "read",
    resourceType: "payment",
    dataSensitivity: "confidential",
    externalCommunication: false,
    requiresApproval: false,
    financialImpact: false,
    argumentFields: [{ key: "payment_id", type: "string", required: true, identifiesResource: true }],
    preconditions: [],
    effects: [],
    alternativeOperationIds: [],
    ...over,
  };
}

describe("buildMcpToolCatalog", () => {
  beforeEach(() => {
    tenantForTask.mockReset();
    activeContractForTask.mockReset();
    buildTenantRegistry.mockReset();
  });

  it("returns task_not_found when the task has no resolvable tenant", async () => {
    tenantForTask.mockResolvedValue(null);
    const result = await buildMcpToolCatalog("task-1");
    expect(result).toEqual({ status: "task_not_found", tenantId: null, tools: [] });
    expect(activeContractForTask).not.toHaveBeenCalled();
  });

  it("returns no_active_contract when the tenant resolves but the task has no active contract", async () => {
    tenantForTask.mockResolvedValue("tenant-a");
    activeContractForTask.mockResolvedValue(null);
    const result = await buildMcpToolCatalog("task-1");
    expect(result).toEqual({ status: "no_active_contract", tenantId: "tenant-a", tools: [] });
  });

  it("builds one tool per distinct allowed action, deduplicated", async () => {
    tenantForTask.mockResolvedValue("tenant-a");
    activeContractForTask.mockResolvedValue({
      contractId: "c-1",
      allowedActions: [
        { tool: "stripe.retrieve_payment", constraints: [] },
        { tool: "stripe.retrieve_payment", constraints: [] }, // duplicate
      ],
    });
    buildTenantRegistry.mockResolvedValue({ operations: new Map([["stripe.retrieve_payment", op()]]) });
    const result = await buildMcpToolCatalog("task-1");
    expect(result.status).toBe("ok");
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("stripe.retrieve_payment");
    expect(result.tools[0].inputSchema.payment_id).toBeDefined();
  });

  it("skips an allowed tool the current registry no longer defines, never guessing its shape", async () => {
    tenantForTask.mockResolvedValue("tenant-a");
    activeContractForTask.mockResolvedValue({
      contractId: "c-1",
      allowedActions: [{ tool: "custom_abc.retired_op", constraints: [] }],
    });
    buildTenantRegistry.mockResolvedValue({ operations: new Map() });
    const result = await buildMcpToolCatalog("task-1");
    expect(result.status).toBe("ok");
    expect(result.tools).toHaveLength(0);
  });

  it("marks an optional field's Zod schema as optional and a required field's as required", async () => {
    tenantForTask.mockResolvedValue("tenant-a");
    activeContractForTask.mockResolvedValue({
      contractId: "c-1",
      allowedActions: [{ tool: "gmail.send_email", constraints: [] }],
    });
    const gmailOp = op({
      id: "gmail.send_email",
      argumentFields: [
        { key: "to", type: "string", required: true, identifiesResource: true },
        { key: "body", type: "string", required: false, identifiesResource: false },
      ],
    });
    buildTenantRegistry.mockResolvedValue({ operations: new Map([["gmail.send_email", gmailOp]]) });
    const result = await buildMcpToolCatalog("task-1");
    const tool = result.tools[0];
    expect(tool.inputSchema.to.isOptional()).toBe(false);
    expect(tool.inputSchema.body.isOptional()).toBe(true);
  });

  it("describes a tool's approval/external-communication/financial-impact flags in its description", async () => {
    tenantForTask.mockResolvedValue("tenant-a");
    activeContractForTask.mockResolvedValue({
      contractId: "c-1",
      allowedActions: [{ tool: "gmail.send_email", constraints: [] }],
    });
    const gmailOp = op({ id: "gmail.send_email", externalCommunication: true, sideEffect: "write_create" });
    buildTenantRegistry.mockResolvedValue({ operations: new Map([["gmail.send_email", gmailOp]]) });
    const result = await buildMcpToolCatalog("task-1");
    expect(result.tools[0].description).toContain("Sends data outside the organization.");
  });
});
