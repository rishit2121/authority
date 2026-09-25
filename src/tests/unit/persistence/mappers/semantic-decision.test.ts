import { describe, expect, it } from "vitest";

import {
  semanticDecisionInputToInsertRow,
  semanticDecisionRowToDomain,
} from "@/lib/persistence/mappers/semantic-decision";
import type { Tables } from "@/lib/persistence/db-types";

const ROW: Tables<"semantic_decisions"> = {
  id: "sd000000-0000-4000-8000-000000000001",
  tenant_id: "11111111-1111-4111-8111-111111111111",
  task_id: "ta000000-0000-4000-8000-000000000001",
  tool_request_id: "tr000000-0000-4000-8000-000000000001",
  provider: "mock",
  model: "heuristic-v1",
  model_version: "1.0.0",
  probabilities: {
    schemaVersion: 1,
    taskRelevance: 0.95,
    resourceRelevance: 0.93,
    scopeExpansion: 0.05,
    externalDisclosure: 0.02,
    planConsistency: 0.97,
    semanticRisk: 0.06,
  },
  confidence: 0.9,
  latency_ms: 42,
  state: "ok",
  error_category: null,
  error_message: null,
  demo_key: "demo:sem:991:pr",
  evaluated_at: "2026-01-01T00:00:00.000Z",
};

describe("semanticDecisionRowToDomain", () => {
  it("maps every probability field and has no id/tenantId/taskId of its own", () => {
    const domain = semanticDecisionRowToDomain(ROW);
    expect(domain).toEqual({
      provider: "mock",
      model: "heuristic-v1",
      modelVersion: "1.0.0",
      taskRelevanceProbability: 0.95,
      resourceRelevanceProbability: 0.93,
      scopeExpansionProbability: 0.05,
      externalDisclosureProbability: 0.02,
      planConsistencyProbability: 0.97,
      semanticRiskProbability: 0.06,
      overallConfidence: 0.9,
      latencyMs: 42,
      state: "ok",
      evaluatedAt: ROW.evaluated_at,
    });
  });

  it("handles the timeout and error states", () => {
    expect(semanticDecisionRowToDomain({ ...ROW, state: "timeout" }).state).toBe("timeout");
    expect(
      semanticDecisionRowToDomain({ ...ROW, state: "error", error_message: "provider unreachable" })
        .errorMessage,
    ).toBe("provider unreachable");
  });

  it("rejects a probability outside [0, 1]", () => {
    // Written out rather than spread: `probabilities` is typed as the
    // generic `Json` union, which isn't safely spreadable.
    const badRow = {
      ...ROW,
      probabilities: {
        schemaVersion: 1,
        taskRelevance: 1.4,
        resourceRelevance: 0.93,
        scopeExpansion: 0.05,
        externalDisclosure: 0.02,
        planConsistency: 0.97,
        semanticRisk: 0.06,
      },
    };
    expect(() => semanticDecisionRowToDomain(badRow)).toThrow();
  });

  it("rejects an unrecognized probabilities schema version", () => {
    expect(() =>
      semanticDecisionRowToDomain({ ...ROW, probabilities: { schemaVersion: 3, taskRelevance: 0.5 } }),
    ).toThrow();
  });
});

describe("semanticDecisionInputToInsertRow", () => {
  it("flattens the domain probability fields back into the versioned shape", () => {
    const row = semanticDecisionInputToInsertRow({
      tenantId: ROW.tenant_id,
      taskId: ROW.task_id,
      toolRequestId: ROW.tool_request_id,
      result: semanticDecisionRowToDomain(ROW),
    });

    expect(row.probabilities).toEqual({
      schemaVersion: 1,
      taskRelevance: 0.95,
      resourceRelevance: 0.93,
      scopeExpansion: 0.05,
      externalDisclosure: 0.02,
      planConsistency: 0.97,
      semanticRisk: 0.06,
    });
    expect(row.confidence).toBe(0.9);
  });
});
