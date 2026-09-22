import { describe, expect, it } from "vitest";

import { RepositoryError } from "@/lib/persistence/errors";
import { contractInputToInsertRow, contractRowToDomain } from "@/lib/persistence/mappers/contract";
import type { Tables } from "@/lib/persistence/db-types";

const ROW: Tables<"task_authority_contracts"> = {
  id: "co000000-0000-4000-8000-000000000001",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  task_id: "ta000000-0000-4000-8000-000000000001",
  version: 1,
  spec_version: "v1",
  allowed_actions: {
    schemaVersion: 1,
    items: [
      { tool: "github.read_issue", constraints: [] },
      {
        tool: "github.create_branch",
        constraints: [{ key: "branch", matches: "fix-*" }],
      },
    ],
  },
  forbidden_resources: ["*secret*", "*credentials*"],
  ephemeral_limits: { schemaVersion: 1, maxToolInvocations: 20, expiresInSeconds: 3600 },
  source_evidence_metadata: { schemaVersion: 1 },
  contract_status: "active",
  created_by: "a0000000-0000-4000-8000-000000000001",
  demo_key: "demo:contract:991",
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("contractRowToDomain", () => {
  it("maps allowed_actions.items and ephemeral_limits into the domain shape", () => {
    const domain = contractRowToDomain(ROW);
    expect(domain.allowedActions).toEqual([
      { tool: "github.read_issue", constraints: [] },
      { tool: "github.create_branch", constraints: [{ key: "branch", matches: "fix-*" }] },
    ]);
    expect(domain.ephemeralLimits).toEqual({ maxToolInvocations: 20, expiresInSeconds: 3600 });
    expect(domain.forbiddenResources).toEqual(["*secret*", "*credentials*"]);
  });

  it("drops version, source_evidence_metadata, contract_status, created_by and demo_key", () => {
    const domain = contractRowToDomain(ROW);
    for (const key of ["version", "sourceEvidenceMetadata", "contractStatus", "createdBy", "demoKey"]) {
      expect(domain).not.toHaveProperty(key);
    }
  });

  it("rejects an unrecognized allowed_actions schema version", () => {
    const badRow = { ...ROW, allowed_actions: { schemaVersion: 2, items: [] } };
    expect(() => contractRowToDomain(badRow)).toThrow(RepositoryError);
  });

  it("rejects an unrecognized ephemeral_limits schema version", () => {
    const badRow = {
      ...ROW,
      ephemeral_limits: { schemaVersion: 2, maxToolInvocations: 1, expiresInSeconds: 1 },
    };
    expect(() => contractRowToDomain(badRow)).toThrow(RepositoryError);
  });

  it("rejects a resource constraint carrying neither equals nor matches", () => {
    const badRow = {
      ...ROW,
      allowed_actions: {
        schemaVersion: 1,
        items: [{ tool: "github.read_issue", constraints: [{ key: "branch" }] }],
      },
    };
    expect(() => contractRowToDomain(badRow)).toThrow();
  });
});

describe("contractInputToInsertRow", () => {
  it("wraps allowedActions and ephemeralLimits with schemaVersion 1", () => {
    const row = contractInputToInsertRow({
      tenantId: ROW.tenant_id,
      taskId: ROW.task_id,
      specVersion: "v1",
      allowedActions: [{ tool: "github.read_issue", constraints: [] }],
      forbiddenResources: ["*secret*"],
      ephemeralLimits: { maxToolInvocations: 10, expiresInSeconds: 1800 },
    });

    expect(row.allowed_actions).toEqual({
      schemaVersion: 1,
      items: [{ tool: "github.read_issue", constraints: [] }],
    });
    expect(row.ephemeral_limits).toEqual({
      schemaVersion: 1,
      maxToolInvocations: 10,
      expiresInSeconds: 1800,
    });
  });
});
