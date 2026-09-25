import { describe, expect, it } from "vitest";

import { tenantRowToDomain } from "@/lib/persistence/mappers/tenant";
import type { Tables } from "@/lib/persistence/db-types";

const ROW: Tables<"tenants"> = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Northwind Labs",
  slug: "northwind-labs",
  environment: "development",
  created_by: "a0000000-0000-4000-8000-000000000001",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

describe("tenantRowToDomain", () => {
  it("maps the fields the domain schema defines", () => {
    expect(tenantRowToDomain(ROW)).toEqual({
      id: ROW.id,
      name: ROW.name,
      slug: ROW.slug,
      createdAt: ROW.created_at,
    });
  });

  it("drops database-only columns rather than widening the domain", () => {
    const domain = tenantRowToDomain(ROW);
    expect(domain).not.toHaveProperty("environment");
    expect(domain).not.toHaveProperty("createdBy");
    expect(domain).not.toHaveProperty("updatedAt");
  });

  it("rejects a row whose slug violates the domain's stricter pattern", () => {
    expect(() => tenantRowToDomain({ ...ROW, slug: "UPPERCASE" })).toThrow();
  });
});
