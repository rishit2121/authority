import { describe, expect, it } from "vitest";

import {
  approvalInputToInsertRow,
  approvalRowToDomain,
  resolveApprovalToUpdateRow,
} from "@/lib/persistence/mappers/approval";
import type { Tables } from "@/lib/persistence/db-types";

const ROW: Tables<"approvals"> = {
  id: "ap000000-0000-4000-8000-000000000001",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  task_id: "ta000000-0000-4000-8000-000000000001",
  authorization_decision_id: "de000000-0000-4000-8000-000000000001",
  requested_authority_delta: null,
  requested_by: "a0000000-0000-4000-8000-000000000001",
  requested_from_principal_id: "p0000000-0000-4000-8000-000000000002",
  assigned_approver_principal_id: null,
  status: "pending",
  summary: "coding-agent-17 requested to modify ci.yml.",
  decision_reason: null,
  requested_at: "2026-01-01T00:00:00.000Z",
  decided_at: null,
  responded_by_principal_id: null,
  demo_key: "demo:approval:991:workflow",
  created_at: "2026-01-01T00:00:00.000Z",
  contract_id: null,
  contract_version: null,
  plan_id: null,
  input_hash: null,
  output_hash: null,
  registry_version: null,
  compiler_version: null,
  required_kind: null,
  required_role: null,
  slot_index: null,
  self_approval_allowed: false,
};

describe("approvalRowToDomain", () => {
  it("maps authorization_decision_id to decisionId and requested_from_principal_id to requestedFromPrincipalId", () => {
    const domain = approvalRowToDomain(ROW);
    expect(domain.decisionId).toBe(ROW.authorization_decision_id);
    expect(domain.requestedFromPrincipalId).toBe(ROW.requested_from_principal_id);
  });

  it("maps decided_at to respondedAt and decision_reason to responseNote once resolved", () => {
    const resolved = approvalRowToDomain({
      ...ROW,
      status: "approved",
      decided_at: "2026-01-01T00:10:00.000Z",
      decision_reason: "Reviewed and approved.",
      responded_by_principal_id: "p0000000-0000-4000-8000-000000000003",
    });
    expect(resolved.respondedAt).toBe("2026-01-01T00:10:00.000Z");
    expect(resolved.responseNote).toBe("Reviewed and approved.");
    expect(resolved.respondedByPrincipalId).toBe("p0000000-0000-4000-8000-000000000003");
  });

  it("drops requested_authority_delta, requested_by and assigned_approver_principal_id", () => {
    const domain = approvalRowToDomain(ROW);
    for (const key of ["requestedAuthorityDelta", "requestedBy", "assignedApproverPrincipalId"]) {
      expect(domain).not.toHaveProperty(key);
    }
  });

  it("handles every approval status", () => {
    for (const status of ["pending", "approved", "rejected", "expired"] as const) {
      expect(approvalRowToDomain({ ...ROW, status }).status).toBe(status);
    }
  });
});

describe("approvalInputToInsertRow", () => {
  it("builds an insert row for a new approval request", () => {
    const row = approvalInputToInsertRow({
      tenantId: ROW.tenant_id,
      taskId: ROW.task_id,
      decisionId: ROW.authorization_decision_id!,
      requestedFromPrincipalId: ROW.requested_from_principal_id!,
      summary: ROW.summary,
    });
    expect(row.authorization_decision_id).toBe(ROW.authorization_decision_id);
    expect(row.requested_by).toBeNull();
  });
});

describe("resolveApprovalToUpdateRow", () => {
  it("builds an update row that stamps decided_at", () => {
    const row = resolveApprovalToUpdateRow({
      status: "approved",
      responseNote: "Looks fine.",
      respondedByPrincipalId: "p0000000-0000-4000-8000-000000000003",
    });
    expect(row.status).toBe("approved");
    expect(row.decision_reason).toBe("Looks fine.");
    expect(typeof row.decided_at).toBe("string");
  });
});
