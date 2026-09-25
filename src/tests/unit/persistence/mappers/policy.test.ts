import { describe, expect, it } from "vitest";

import { policyInputToInsertRow, policyRowToDomain } from "@/lib/persistence/mappers/policy";
import type { Tables } from "@/lib/persistence/db-types";

const ROW: Tables<"policies"> = {
  id: "po000000-0000-4000-8000-000000000001",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  name: "Never read repository secrets",
  description: "Hard denial on secret-like resources.",
  version: 1,
  status: "active",
  effect: "deny",
  conditions: { schemaVersion: 1, rules: [{ key: "resource", matches: "*secret*" }] },
  created_by: "a0000000-0000-4000-8000-000000000001",
  demo_key: "demo:policy:no-secrets",
  created_at: "2026-01-01T00:00:00.000Z",
  activated_at: "2026-01-01T00:00:00.000Z",
  required_approval_role: null,
  required_approval_count: null,
};

describe("policyRowToDomain", () => {
  it("unwraps conditions.rules into the domain's conditions array", () => {
    const domain = policyRowToDomain(ROW);
    expect(domain.conditions).toEqual([{ key: "resource", matches: "*secret*" }]);
  });

  it("carries activatedAt only once activated", () => {
    const draft = policyRowToDomain({ ...ROW, status: "draft", activated_at: null });
    expect(draft.activatedAt).toBeUndefined();
    expect(policyRowToDomain(ROW).activatedAt).toBe(ROW.activated_at);
  });

  it("drops created_by and demo_key", () => {
    const domain = policyRowToDomain(ROW);
    expect(domain).not.toHaveProperty("createdBy");
    expect(domain).not.toHaveProperty("demoKey");
  });

  it("handles draft, active and archived status", () => {
    for (const status of ["draft", "active", "archived"] as const) {
      expect(policyRowToDomain({ ...ROW, status }).status).toBe(status);
    }
  });

  it("rejects an unrecognized conditions schema version", () => {
    expect(() => policyRowToDomain({ ...ROW, conditions: { schemaVersion: 2, rules: [] } })).toThrow();
  });
});

describe("policyInputToInsertRow", () => {
  it("wraps conditions with schemaVersion 1, defaulting to an empty array", () => {
    const row = policyInputToInsertRow({
      tenantId: ROW.tenant_id,
      name: "New draft policy",
      effect: "deny",
    });
    expect(row.conditions).toEqual({ schemaVersion: 1, rules: [] });
  });
});
