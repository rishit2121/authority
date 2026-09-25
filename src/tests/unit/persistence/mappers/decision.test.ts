import { describe, expect, it } from "vitest";

import { decisionInputToInsertRow, decisionRowToDomain } from "@/lib/persistence/mappers/decision";
import type { Tables } from "@/lib/persistence/db-types";

const ROW: Tables<"authorization_decisions"> = {
  id: "de000000-0000-4000-8000-000000000001",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  task_id: "ta000000-0000-4000-8000-000000000001",
  tool_request_id: "tr000000-0000-4000-8000-000000000001",
  contract_id: "co000000-0000-4000-8000-000000000001",
  contract_version: 1,
  semantic_decision_id: null,
  outcome: "allow_constrained",
  reason_codes: {
    schemaVersion: 1,
    items: [{ code: "WITHIN_CONTRACT", detail: "Permitted.", source: "contract" }],
  },
  applied_constraints: {
    schemaVersion: 1,
    items: [{ key: "branch", matches: "fix-*" }],
  },
  matched_policy_ids: [],
  evidence_references: null,
  latency_ms: 5,
  demo_key: "demo:dec:991:3",
  created_at: "2026-01-01T00:00:00.000Z",
};

const SEMANTIC_ROW: Tables<"semantic_decisions"> = {
  id: "sd000000-0000-4000-8000-000000000001",
  tenant_id: ROW.tenant_id,
  task_id: ROW.task_id,
  tool_request_id: ROW.tool_request_id,
  provider: "mock",
  model: "heuristic-v1",
  model_version: "1.0.0",
  probabilities: {
    schemaVersion: 1,
    taskRelevance: 0.9,
    resourceRelevance: 0.9,
    scopeExpansion: 0.1,
    externalDisclosure: 0.05,
    planConsistency: 0.9,
    semanticRisk: 0.1,
  },
  confidence: 0.85,
  latency_ms: 40,
  state: "ok",
  error_category: null,
  error_message: null,
  demo_key: null,
  evaluated_at: "2026-01-01T00:00:00.000Z",
};

describe("decisionRowToDomain", () => {
  it("maps outcome to status and created_at to decidedAt", () => {
    const domain = decisionRowToDomain(ROW);
    expect(domain.status).toBe("allow_constrained");
    expect(domain.decidedAt).toBe(ROW.created_at);
  });

  it("unwraps reason_codes.items and applied_constraints.items", () => {
    const domain = decisionRowToDomain(ROW);
    expect(domain.reasons).toEqual([{ code: "WITHIN_CONTRACT", detail: "Permitted.", source: "contract" }]);
    expect(domain.appliedConstraints).toEqual([{ key: "branch", matches: "fix-*" }]);
  });

  it("drops contract_id, contract_version, matched_policy_ids and evidence_references", () => {
    const domain = decisionRowToDomain(ROW);
    for (const key of ["contractId", "contractVersion", "matchedPolicyIds", "evidenceReferences"]) {
      expect(domain).not.toHaveProperty(key);
    }
  });

  it("embeds semantic evidence when a joined semantic row is supplied", () => {
    const withSemantic = { ...ROW, semantic_decision_id: SEMANTIC_ROW.id };
    const domain = decisionRowToDomain(withSemantic, SEMANTIC_ROW);

    expect(domain.semanticEvidence).toBeDefined();
    expect(domain.semanticEvidence?.provider).toBe("mock");
    expect(domain.semanticEvidence?.taskRelevanceProbability).toBe(0.9);
  });

  it("has no semanticEvidence when no semantic decision is referenced", () => {
    const domain = decisionRowToDomain(ROW);
    expect(domain.semanticEvidence).toBeUndefined();
  });

  it("handles every outcome value", () => {
    const outcomes = ["allow", "allow_constrained", "replan", "clarify", "require_approval", "deny"] as const;
    for (const outcome of outcomes) {
      expect(decisionRowToDomain({ ...ROW, outcome }).status).toBe(outcome);
    }
  });

  it("rejects an unrecognized reason source", () => {
    const badRow = {
      ...ROW,
      reason_codes: {
        schemaVersion: 1,
        items: [{ code: "X", detail: "Y", source: "not-a-real-source" }],
      },
    };
    expect(() => decisionRowToDomain(badRow)).toThrow();
  });
});

describe("decisionInputToInsertRow", () => {
  it("wraps reasons and appliedConstraints with schemaVersion 1", () => {
    const row = decisionInputToInsertRow({
      tenantId: ROW.tenant_id,
      taskId: ROW.task_id,
      toolRequestId: ROW.tool_request_id,
      contractId: ROW.contract_id,
      contractVersion: 1,
      status: "allow",
      reasons: [{ code: "WITHIN_CONTRACT", detail: "ok", source: "contract" }],
      latencyMs: 3,
    });

    expect(row.reason_codes).toEqual({
      schemaVersion: 1,
      items: [{ code: "WITHIN_CONTRACT", detail: "ok", source: "contract" }],
    });
    expect(row.applied_constraints).toEqual({ schemaVersion: 1, items: [] });
    expect(row.outcome).toBe("allow");
  });
});
