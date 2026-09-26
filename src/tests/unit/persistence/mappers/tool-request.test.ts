import { describe, expect, it } from "vitest";

import { toolRequestInputToInsertRow, toolRequestRowToDomain } from "@/lib/persistence/mappers/tool-request";
import type { Tables } from "@/lib/persistence/db-types";

const ROW: Tables<"tool_requests"> = {
  id: "tr000000-0000-4000-8000-000000000001",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  task_id: "ta000000-0000-4000-8000-000000000001",
  plan_id: "pl000000-0000-4000-8000-000000000001",
  plan_node_id: "no000000-0000-4000-8000-000000000001",
  agent_id: "ag000000-0000-4000-8000-000000000001",
  tool: "github.create_branch",
  operation: "create_branch",
  resource: "fix-991",
  normalized_arguments: { schemaVersion: 1, values: { branch: "fix-991" } },
  expected_effect: null,
  destination_metadata: null,
  provenance: "agent_proposed",
  idempotency_key: "demo:991:create-branch",
  demo_key: "demo:req:991:3",
  requested_at: "2026-01-01T00:00:00.000Z",
  request_hash: null,
};

describe("toolRequestRowToDomain", () => {
  it("maps to the domain shape, unwrapping normalized_arguments.values", () => {
    expect(toolRequestRowToDomain(ROW)).toEqual({
      id: ROW.id,
      tenantId: ROW.tenant_id,
      taskId: ROW.task_id,
      agentId: ROW.agent_id,
      tool: "github.create_branch",
      arguments: { branch: "fix-991" },
      planNodeId: ROW.plan_node_id,
      requestedAt: ROW.requested_at,
    });
  });

  it("omits planNodeId when the row has none", () => {
    const domain = toolRequestRowToDomain({ ...ROW, plan_node_id: null });
    expect(domain.planNodeId).toBeUndefined();
  });

  it("drops plan_id, operation, resource, provenance and idempotency_key", () => {
    const domain = toolRequestRowToDomain(ROW);
    for (const key of ["planId", "operation", "resource", "provenance", "idempotencyKey"]) {
      expect(domain).not.toHaveProperty(key);
    }
  });

  it("rejects a malformed tool name", () => {
    expect(() => toolRequestRowToDomain({ ...ROW, tool: "not-dotted" })).toThrow();
  });
});

describe("toolRequestInputToInsertRow", () => {
  it("derives operation from the tool when not supplied", () => {
    const row = toolRequestInputToInsertRow({
      tenantId: ROW.tenant_id,
      taskId: ROW.task_id,
      agentId: ROW.agent_id,
      tool: "stripe.create_refund",
      arguments: { order_id: "4821" },
      idempotencyKey: "demo:4821:create-refund",
    });
    expect(row.operation).toBe("create_refund");
    expect(row.normalized_arguments).toEqual({ schemaVersion: 1, values: { order_id: "4821" } });
  });
});
