import { describe, expect, it } from "vitest";

import { principalInputToInsertRow, principalRowToDomain } from "@/lib/persistence/mappers/principal";
import type { Tables } from "@/lib/persistence/db-types";

const ROW: Tables<"principals"> = {
  id: "p0000000-0000-4000-8000-000000000001",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  kind: "human",
  display_name: "Maya Okafor",
  email: "maya@northwind.example",
  user_id: null,
  demo_key: "demo:principal:maya",
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("principalRowToDomain", () => {
  it("maps a human principal", () => {
    expect(principalRowToDomain(ROW)).toEqual({
      id: ROW.id,
      tenantId: ROW.tenant_id,
      kind: "human",
      displayName: "Maya Okafor",
      email: "maya@northwind.example",
      createdAt: ROW.created_at,
    });
  });

  it("maps a service principal with no email", () => {
    const serviceRow: Tables<"principals"> = { ...ROW, kind: "service", email: null };
    const domain = principalRowToDomain(serviceRow);
    expect(domain.kind).toBe("service");
    expect(domain.email).toBeUndefined();
  });

  it("drops user_id and demo_key", () => {
    const domain = principalRowToDomain(ROW);
    expect(domain).not.toHaveProperty("userId");
    expect(domain).not.toHaveProperty("demoKey");
  });

  it("rejects an unrecognized kind", () => {
    expect(() => principalRowToDomain({ ...ROW, kind: "robot" as never })).toThrow();
  });
});

describe("principalInputToInsertRow", () => {
  it("builds an insert row from a create input", () => {
    expect(
      principalInputToInsertRow({
        tenantId: ROW.tenant_id,
        kind: "human",
        displayName: "Maya Okafor",
        email: "maya@northwind.example",
      }),
    ).toEqual({
      tenant_id: ROW.tenant_id,
      kind: "human",
      display_name: "Maya Okafor",
      email: "maya@northwind.example",
    });
  });

  it("maps an absent email to null, not undefined", () => {
    const row = principalInputToInsertRow({
      tenantId: ROW.tenant_id,
      kind: "service",
      displayName: "coding-agent-17",
    });
    expect(row.email).toBeNull();
  });
});
