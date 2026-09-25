import { describe, expect, it } from "vitest";

import { capabilityInputToInsertRow, capabilityRowToDomain } from "@/lib/persistence/mappers/capability";
import type { Tables } from "@/lib/persistence/db-types";

const ROW: Tables<"capabilities"> = {
  id: "ca000000-0000-4000-8000-000000000001",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  task_id: "ta000000-0000-4000-8000-000000000001",
  authorization_decision_id: "de000000-0000-4000-8000-000000000001",
  agent_id: "ag000000-0000-4000-8000-000000000001",
  tool: "github.create_branch",
  resource_constraints: { schemaVersion: 1, items: [{ key: "branch", matches: "fix-*" }] },
  argument_constraints: { schemaVersion: 1, items: [] },
  status: "consumed",
  max_invocations: 3,
  consumed_uses: 1,
  issued_at: "2026-01-01T00:00:00.000Z",
  expires_at: "2026-01-01T01:00:00.000Z",
  revoked_at: null,
  revocation_reason: null,
  demo_key: "demo:cap:991:3",
};

describe("capabilityRowToDomain", () => {
  it("maps authorization_decision_id to decisionId and resource_constraints.items to constraints", () => {
    const domain = capabilityRowToDomain(ROW);
    expect(domain.decisionId).toBe(ROW.authorization_decision_id);
    expect(domain.constraints).toEqual([{ key: "branch", matches: "fix-*" }]);
  });

  it("maps consumed_uses to usedInvocations", () => {
    expect(capabilityRowToDomain(ROW).usedInvocations).toBe(1);
  });

  it("drops agent_id, argument_constraints and demo_key", () => {
    const domain = capabilityRowToDomain(ROW);
    for (const key of ["agentId", "argumentConstraints", "demoKey"]) {
      expect(domain).not.toHaveProperty(key);
    }
  });

  it("carries revocation fields when revoked", () => {
    const revoked = capabilityRowToDomain({
      ...ROW,
      status: "revoked",
      revoked_at: "2026-01-01T00:30:00.000Z",
      revocation_reason: "Task terminated.",
    });
    expect(revoked.revokedAt).toBe("2026-01-01T00:30:00.000Z");
    expect(revoked.revocationReason).toBe("Task terminated.");
  });

  it("rejects consumed_uses exceeding max_invocations, mirroring the domain's own refine", () => {
    expect(() => capabilityRowToDomain({ ...ROW, consumed_uses: 5, max_invocations: 3 })).toThrow();
  });

  it("rejects a missing expiry — capabilities.expires_at is NOT NULL, but the mapper re-checks anyway", () => {
    // @ts-expect-error deliberately malformed to exercise the runtime check
    expect(() => capabilityRowToDomain({ ...ROW, expires_at: null })).toThrow();
  });
});

describe("capabilityInputToInsertRow", () => {
  it("wraps constraints under resource_constraints with schemaVersion 1", () => {
    const row = capabilityInputToInsertRow({
      tenantId: ROW.tenant_id,
      taskId: ROW.task_id,
      decisionId: ROW.authorization_decision_id,
      agentId: ROW.agent_id,
      tool: "github.create_branch",
      constraints: [{ key: "branch", matches: "fix-*" }],
      maxInvocations: 3,
      expiresAt: ROW.expires_at,
    });

    expect(row.resource_constraints).toEqual({
      schemaVersion: 1,
      items: [{ key: "branch", matches: "fix-*" }],
    });
    expect(row.expires_at).toBe(ROW.expires_at);
  });
});
