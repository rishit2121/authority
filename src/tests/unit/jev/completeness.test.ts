import { describe, expect, it, vi } from "vitest";

import {
  buildCompletenessQuestions,
  mapCompletenessAnswers,
  type CompletenessEvaluationInput,
  type JevCompletenessProvider,
} from "@/lib/jev/completeness-provider";
import { MockCompletenessProvider } from "@/lib/jev/mock-completeness-provider";
import { runCompletenessEvaluation } from "@/lib/jev/completeness-runner";
import { CircuitBreaker } from "@/lib/semantic/circuit-breaker";
import { JevProviderError, JevProviderUnavailableError } from "@/lib/jev/types";

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

describe("runCompletenessEvaluation", () => {
  const okProvider: JevCompletenessProvider = {
    name: "mock",
    model: "m",
    modelVersion: "v1",
    evaluate: async () => ({ classification: "complete", confidence: 0.9, possibleMissingOperationIds: [] }),
  };

  it("resolves ok with the evaluation on success", async () => {
    const result = await runCompletenessEvaluation({ provider: okProvider, input });
    expect(result.state).toBe("ok");
    expect(result.evaluation?.classification).toBe("complete");
  });

  it("never throws, and never returns an evaluation on unavailable/timeout/error", async () => {
    const unavailable: JevCompletenessProvider = {
      ...okProvider,
      evaluate: async () => {
        throw new JevProviderUnavailableError("no key");
      },
    };
    const r1 = await runCompletenessEvaluation({ provider: unavailable, input });
    expect(r1).toMatchObject({ state: "unavailable", evaluation: null });

    const erroring: JevCompletenessProvider = {
      ...okProvider,
      evaluate: async () => {
        throw new JevProviderError("malformed_output", "bad");
      },
    };
    const r2 = await runCompletenessEvaluation({ provider: erroring, input });
    expect(r2).toMatchObject({ state: "error", evaluation: null, errorCategory: "malformed_output" });

    const hanging: JevCompletenessProvider = { ...okProvider, evaluate: () => new Promise(() => undefined) };
    const r3 = await runCompletenessEvaluation({ provider: hanging, input, timeoutMs: 20 });
    expect(r3).toMatchObject({ state: "timeout", evaluation: null });
  });

  it("respects an open circuit breaker without calling the provider", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure();
    const spy = vi.fn(okProvider.evaluate);
    const result = await runCompletenessEvaluation({
      provider: { ...okProvider, evaluate: spy },
      input,
      breaker,
    });
    expect(result.state).toBe("circuit_open");
    expect(spy).not.toHaveBeenCalled();
  });
});
