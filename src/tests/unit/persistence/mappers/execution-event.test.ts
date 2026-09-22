import { describe, expect, it } from "vitest";

import {
  executionEventInputToInsertRow,
  executionEventRowToDomain,
} from "@/lib/persistence/mappers/execution-event";
import type { Tables } from "@/lib/persistence/db-types";

const ROW: Tables<"execution_events"> = {
  id: "ev000000-0000-4000-8000-000000000001",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  task_id: "ta000000-0000-4000-8000-000000000001",
  capability_id: "ca000000-0000-4000-8000-000000000001",
  tool_request_id: "tr000000-0000-4000-8000-000000000001",
  decision_id: "de000000-0000-4000-8000-000000000001",
  event_type: "capability_issued",
  result_status: "success",
  summary: "Capability issued for github.create_branch.",
  detail: null,
  normalized_effect_metadata: null,
  receipt_metadata: null,
  demo_key: "demo:event:991:6",
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("executionEventRowToDomain", () => {
  it("maps event_type to type, result_status to outcome, created_at to occurredAt", () => {
    const domain = executionEventRowToDomain(ROW);
    expect(domain.type).toBe("capability_issued");
    expect(domain.outcome).toBe("success");
    expect(domain.occurredAt).toBe(ROW.created_at);
  });

  it("carries decisionId and capabilityId when present", () => {
    const domain = executionEventRowToDomain(ROW);
    expect(domain.decisionId).toBe(ROW.decision_id);
    expect(domain.capabilityId).toBe(ROW.capability_id);
  });

  it("drops tool_request_id — the domain ExecutionEvent has no such field", () => {
    const domain = executionEventRowToDomain(ROW);
    expect(domain).not.toHaveProperty("toolRequestId");
  });

  it("handles every event type and outcome value", () => {
    const types = [
      "task_received",
      "contract_issued",
      "plan_proposed",
      "request_evaluated",
      "capability_issued",
      "tool_invoked",
      "tool_failed",
      "approval_requested",
      "approval_resolved",
      "capability_revoked",
      "task_completed",
      "task_terminated",
    ] as const;
    for (const event_type of types) {
      expect(executionEventRowToDomain({ ...ROW, event_type }).type).toBe(event_type);
    }
    for (const result_status of ["success", "failure", "blocked", "info"] as const) {
      expect(executionEventRowToDomain({ ...ROW, result_status }).outcome).toBe(result_status);
    }
  });

  it("rejects an empty summary", () => {
    expect(() => executionEventRowToDomain({ ...ROW, summary: "" })).toThrow();
  });
});

describe("executionEventInputToInsertRow", () => {
  it("builds an insert row; there is no corresponding update mapper", () => {
    const row = executionEventInputToInsertRow({
      tenantId: ROW.tenant_id,
      taskId: ROW.task_id,
      type: "task_terminated",
      outcome: "info",
      summary: "Operator terminated the task.",
    });
    expect(row.event_type).toBe("task_terminated");
    expect(row.capability_id).toBeNull();
  });
});
