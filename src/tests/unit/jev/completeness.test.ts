import { describe, expect, it } from "vitest";

import {
  buildCompletenessQuestions,
  mapCompletenessAnswers,
  type CompletenessEvaluationInput,
} from "@/lib/jev/completeness-provider";
import { MockCompletenessProvider } from "@/lib/jev/mock-completeness-provider";

const input: CompletenessEvaluationInput = {
  taskIntent: "Resolve issue #991 and open a pull request",
  plan: [
    { id: "n1", tool: "github.get_issue", sideEffect: "read", dependencies: [], dataFlowFromNodeIds: [] },
  ],
  candidateOperationIds: ["github.create_pull_request", "github.create_branch"],
  activePolicySummaries: [],
};

describe("buildCompletenessQuestions / mapCompletenessAnswers", () => {
  it("asks a noul only for the supplied candidate operation ids, never any other registry id", () => {
    const q = buildCompletenessQuestions(input);
    expect(Object.keys(q).filter((k) => k.startsWith("missing_"))).toEqual([
      "missing_github.create_pull_request",
      "missing_github.create_branch",
    ]);
  });

  it("never selects a possibly-missing operation outside the candidate list, even if answered", () => {
    const result = mapCompletenessAnswers(input, {
      classification: { type: "choice", choice: "complete", confidence: 0.8 },
      "missing_github.delete_repository": { type: "noul", noul: 1 },
    });
    expect(result.possibleMissingOperationIds).toEqual([]);
  });

  it("falls back to missing_information, never complete, on an unparseable classification", () => {
    expect(mapCompletenessAnswers(input, {}).classification).toBe("missing_information");
  });

  it("maps a well-formed response", () => {
    const result = mapCompletenessAnswers(input, {
      classification: { type: "choice", choice: "missing_capability_category", confidence: 0.7 },
      "missing_github.create_pull_request": { type: "noul", noul: 0.9 },
    });
    expect(result).toEqual({
      classification: "missing_capability_category",
      confidence: 0.7,
      possibleMissingOperationIds: ["github.create_pull_request"],
    });
  });
});

describe("MockCompletenessProvider", () => {
  it("is clearly labeled", () => {
    expect(new MockCompletenessProvider().name).toBe("mock");
  });

  it("flags an all-read plan as missing a capability category", async () => {
    const result = await new MockCompletenessProvider().evaluate(input, {
      signal: new AbortController().signal,
    });
    expect(result.classification).toBe("missing_capability_category");
  });
});
