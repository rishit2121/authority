import { describe, expect, it } from "vitest";

import { taskInputToInsertRow, taskRowToDomain } from "@/lib/persistence/mappers/task";
import type { Tables } from "@/lib/persistence/db-types";

const ROW: Tables<"tasks"> = {
  id: "ta000000-0000-4000-8000-000000000001",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  agent_id: "ag000000-0000-4000-8000-000000000001",
  principal_id: "p0000000-0000-4000-8000-000000000001",
  initiating_user_id: "a0000000-0000-4000-8000-000000000001",
  intent: "Resolve issue #991 in payments-api and open a pull request.",
  trusted_context_provenance: { schemaVersion: 1, source: "unspecified" },
  status: "executing",
  started_at: "2026-01-01T00:00:00.000Z",
  completed_at: null,
  terminated_at: null,
  demo_key: "demo:task:991",
  idempotency_key: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:05:00.000Z",
};

describe("taskRowToDomain", () => {
  it("maps the domain fields and sources completedAt only from completed_at", () => {
    expect(taskRowToDomain(ROW)).toEqual({
      id: ROW.id,
      tenantId: ROW.tenant_id,
      agentId: ROW.agent_id,
      principalId: ROW.principal_id,
      intent: ROW.intent,
      status: "executing",
      createdAt: ROW.created_at,
    });
  });

  it("carries completedAt when the task has one, and drops terminated_at entirely", () => {
    const completedRow: Tables<"tasks"> = {
      ...ROW,
      status: "completed",
      completed_at: "2026-01-01T01:00:00.000Z",
      terminated_at: "2026-01-01T01:00:00.000Z",
    };
    const domain = taskRowToDomain(completedRow);
    expect(domain.completedAt).toBe("2026-01-01T01:00:00.000Z");
    expect(domain).not.toHaveProperty("terminatedAt");
  });

  it("drops initiating_user_id and trusted_context_provenance", () => {
    const domain = taskRowToDomain(ROW);
    expect(domain).not.toHaveProperty("initiatingUserId");
    expect(domain).not.toHaveProperty("trustedContextProvenance");
  });

  it("handles every task status value", () => {
    const statuses = [
      "pending",
      "contract_issued",
      "executing",
      "awaiting_approval",
      "completed",
      "failed",
      "terminated",
    ] as const;
    for (const status of statuses) {
      expect(taskRowToDomain({ ...ROW, status }).status).toBe(status);
    }
  });

  it("rejects a row with a malformed timestamp", () => {
    expect(() => taskRowToDomain({ ...ROW, created_at: "not-a-timestamp" })).toThrow();
  });
});

describe("taskInputToInsertRow", () => {
  it("builds an insert row, defaulting initiatingUserId to null", () => {
    const row = taskInputToInsertRow({
      tenantId: ROW.tenant_id,
      agentId: ROW.agent_id,
      principalId: ROW.principal_id,
      intent: ROW.intent,
    });
    expect(row.initiating_user_id).toBeNull();
    expect(row.intent).toBe(ROW.intent);
  });
});
