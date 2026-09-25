import { describe, expect, it } from "vitest";

import { agentInputToInsertRow, agentRowToDomain } from "@/lib/persistence/mappers/agent";
import type { Tables } from "@/lib/persistence/db-types";

const ROW: Tables<"agents"> = {
  id: "ag000000-0000-4000-8000-000000000001",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  name: "coding-agent-17",
  description: "Resolves GitHub issues.",
  model_provider: "openai",
  model: "gpt-4.1",
  framework: "langchain",
  owner_principal_id: "p0000000-0000-4000-8000-000000000001",
  environment: "development",
  risk_tier: "medium",
  status: "active",
  demo_key: "demo:agent:coding",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

describe("agentRowToDomain", () => {
  it("maps exactly the seven fields the domain Agent defines", () => {
    expect(agentRowToDomain(ROW)).toEqual({
      id: ROW.id,
      tenantId: ROW.tenant_id,
      name: "coding-agent-17",
      model: "gpt-4.1",
      framework: "langchain",
      ownerPrincipalId: ROW.owner_principal_id,
      status: "active",
      createdAt: ROW.created_at,
    });
  });

  it("drops description, model_provider, environment, risk_tier and updated_at", () => {
    const domain = agentRowToDomain(ROW);
    for (const key of ["description", "modelProvider", "environment", "riskTier", "updatedAt"]) {
      expect(domain).not.toHaveProperty(key);
    }
  });

  it("handles every agent status value", () => {
    for (const status of ["active", "paused", "revoked"] as const) {
      expect(agentRowToDomain({ ...ROW, status }).status).toBe(status);
    }
  });

  it("rejects an unrecognized status", () => {
    expect(() => agentRowToDomain({ ...ROW, status: "deleted" as never })).toThrow();
  });
});

describe("agentInputToInsertRow", () => {
  it("carries the database-only fields the domain type doesn't have", () => {
    const row = agentInputToInsertRow({
      tenantId: ROW.tenant_id,
      name: "coding-agent-17",
      model: "gpt-4.1",
      framework: "langchain",
      ownerPrincipalId: ROW.owner_principal_id,
      modelProvider: "openai",
      description: "Resolves GitHub issues.",
      environment: "development",
      riskTier: "medium",
    });

    expect(row.model_provider).toBe("openai");
    expect(row.description).toBe("Resolves GitHub issues.");
    expect(row.environment).toBe("development");
    expect(row.risk_tier).toBe("medium");
  });

  it("maps an absent description to null", () => {
    const row = agentInputToInsertRow({
      tenantId: ROW.tenant_id,
      name: "x",
      model: "y",
      framework: "z",
      ownerPrincipalId: ROW.owner_principal_id,
      modelProvider: "openai",
    });
    expect(row.description).toBeNull();
  });
});
