import { describe, expect, it } from "vitest";

import {
  integrationInputToInsertRow,
  integrationRowToDomain,
  updateIntegrationToUpdateRow,
} from "@/lib/persistence/mappers/integration";
import type { Tables } from "@/lib/persistence/db-types";

const ROW: Tables<"integrations"> = {
  id: "in000000-0000-4000-8000-000000000001",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  provider: "github",
  display_name: "GitHub",
  status: "connected",
  configured_scopes_metadata: { schemaVersion: 1, scopes: ["repo:read"] },
  health_metadata: null,
  created_by: "a0000000-0000-4000-8000-000000000002",
  demo_key: "demo:integration:github",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("integrationRowToDomain", () => {
  it("maps the fields the domain schema defines", () => {
    expect(integrationRowToDomain(ROW)).toEqual({
      id: ROW.id,
      tenantId: ROW.tenant_id,
      provider: "github",
      displayName: "GitHub",
      status: "connected",
      createdAt: ROW.created_at,
      updatedAt: ROW.updated_at,
    });
  });

  it("drops configured_scopes_metadata, health_metadata and created_by — never a credential", () => {
    const domain = integrationRowToDomain(ROW);
    for (const key of ["configuredScopesMetadata", "healthMetadata", "createdBy"]) {
      expect(domain).not.toHaveProperty(key);
    }
  });

  it("handles every provider and status value", () => {
    for (const provider of ["github", "stripe", "gmail", "postgres", "slack", "salesforce"] as const) {
      expect(integrationRowToDomain({ ...ROW, provider }).provider).toBe(provider);
    }
    for (const status of ["connected", "warning", "not_connected"] as const) {
      expect(integrationRowToDomain({ ...ROW, status }).status).toBe(status);
    }
  });
});

describe("integrationInputToInsertRow", () => {
  it("builds an insert row with no credential field to populate", () => {
    const row = integrationInputToInsertRow({
      tenantId: ROW.tenant_id,
      provider: "slack",
      displayName: "Slack",
    });
    expect(row.provider).toBe("slack");
    expect(Object.keys(row)).not.toContain("token");
    expect(Object.keys(row)).not.toContain("credential");
  });
});

describe("updateIntegrationToUpdateRow", () => {
  it("builds a partial update row", () => {
    expect(updateIntegrationToUpdateRow({ status: "warning" })).toEqual({
      display_name: undefined,
      status: "warning",
    });
  });
});
