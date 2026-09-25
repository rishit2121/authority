import { describe, expect, it } from "vitest";

import {
  candidatePlanNodeSchema,
  candidatePlanSchema,
  MAX_CANDIDATE_PLAN_NODES,
} from "@/lib/domain/candidate-plan";

function validNode(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "a",
    sequence: 0,
    tool: "github.get_issue",
    arguments: { issue_number: "991" },
    expectedSideEffect: "read",
    ...overrides,
  };
}

describe("candidatePlanNodeSchema — maxInvocations (excess invocation budget)", () => {
  it("defaults to 1 when omitted", () => {
    const result = candidatePlanNodeSchema.parse(validNode());
    expect(result.maxInvocations).toBe(1);
  });

  it("accepts the maximum of 20", () => {
    expect(() => candidatePlanNodeSchema.parse(validNode({ maxInvocations: 20 }))).not.toThrow();
  });

  it("rejects a value over the cap — excess invocation budget", () => {
    expect(() => candidatePlanNodeSchema.parse(validNode({ maxInvocations: 21 }))).toThrow();
  });

  it("rejects zero and negative invocation counts", () => {
    expect(() => candidatePlanNodeSchema.parse(validNode({ maxInvocations: 0 }))).toThrow();
    expect(() => candidatePlanNodeSchema.parse(validNode({ maxInvocations: -1 }))).toThrow();
  });

  it("rejects a non-integer invocation count", () => {
    expect(() => candidatePlanNodeSchema.parse(validNode({ maxInvocations: 1.5 }))).toThrow();
  });
});

describe("candidatePlanSchema — bounded plan size", () => {
  function planWithNodeCount(n: number) {
    return {
      schemaVersion: 1,
      taskId: "task_1",
      nodes: Array.from({ length: n }, (_, i) => validNode({ id: `n${i}`, sequence: i })),
    };
  }

  it("accepts exactly the maximum node count", () => {
    expect(() => candidatePlanSchema.parse(planWithNodeCount(MAX_CANDIDATE_PLAN_NODES))).not.toThrow();
  });

  it("rejects one more than the maximum node count", () => {
    expect(() => candidatePlanSchema.parse(planWithNodeCount(MAX_CANDIDATE_PLAN_NODES + 1))).toThrow();
  });

  it("rejects an empty node list", () => {
    expect(() => candidatePlanSchema.parse(planWithNodeCount(0))).toThrow();
  });

  it("rejects an unrecognized schema version", () => {
    const plan = { ...planWithNodeCount(1), schemaVersion: 2 };
    expect(() => candidatePlanSchema.parse(plan)).toThrow();
  });

  it("rejects an unknown top-level field (strict schema)", () => {
    const plan = { ...planWithNodeCount(1), extra: "not allowed" };
    expect(() => candidatePlanSchema.parse(plan)).toThrow();
  });
});
