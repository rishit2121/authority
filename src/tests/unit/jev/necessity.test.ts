import { describe, expect, it, vi } from "vitest";

import { CircuitBreaker } from "@/lib/semantic/circuit-breaker";
import {
  buildNecessityQuestions,
  mapNecessityAnswers,
  type NecessityEvaluationInput,
} from "@/lib/jev/necessity-provider";
import { MockNecessityProvider } from "@/lib/jev/mock-necessity-provider";
import { runNecessityEvaluation } from "@/lib/jev/necessity-runner";
import { JevProviderError, JevProviderUnavailableError } from "@/lib/jev/types";
import type { JevNecessityProvider } from "@/lib/jev/necessity-provider";

const baseInput = (over: Partial<NecessityEvaluationInput> = {}): NecessityEvaluationInput => ({
  taskId: "task_1",
  taskIntent: "Resolve issue #991 in payments-api and open a pull request.",
  plan: [
    { id: "read", tool: "github.get_issue", sideEffect: "read", dependencies: [], dataFlowFromNodeIds: [] },
    {
      id: "branch",
      tool: "github.create_branch",
      sideEffect: "write_create",
      dependencies: ["read"],
      dataFlowFromNodeIds: [],
    },
  ],
  nodeId: "branch",
  inBackwardSlice: true,
  registryOperation: {
    id: "github.create_branch",
    provider: "github",
    sideEffect: "write_create",
    resourceType: "branch",
    dataSensitivity: "internal",
    preconditions: ["The repository must already exist."],
    effects: ["Creates a new branch."],
    alternativeOperationIds: [],
  },
  activePolicySummaries: [],
  agentJustification: "I need a branch to make the fix on.",
  ...over,
});

describe("buildNecessityQuestions", () => {
  it("asks a noul only for node ids in this node's own declared dependencies, never any other plan node", () => {
    const q = buildNecessityQuestions(baseInput());
    expect(Object.keys(q)).toContain("predecessor_read");
    expect(Object.keys(q).filter((k) => k.startsWith("predecessor_"))).toEqual(["predecessor_read"]);
  });

  it("asks a noul only for registry-curated alternative operation ids, never an invented one", () => {
    const input = baseInput({
      registryOperation: { ...baseInput().registryOperation, alternativeOperationIds: ["github.put_file"] },
    });
    const q = buildNecessityQuestions(input);
    expect(Object.keys(q)).toContain("alternative_github.put_file");
    expect(Object.keys(q).filter((k) => k.startsWith("alternative_"))).toEqual([
      "alternative_github.put_file",
    ]);
  });

  it("asks every fixed reason-code and missing-information question, and exactly one classification choice", () => {
    const q = buildNecessityQuestions(baseInput());
    expect(q.classification.type).toBe("choice");
    expect(Object.keys(q.classification.criteria!)).toEqual([
      "required",
      "conditional",
      "unjustified",
      "ambiguous",
    ]);
    for (const code of ["direct_task_requirement", "duplicate_operation", "unrelated_resource"]) {
      expect(q[`reason_${code}`]?.type).toBe("noul");
    }
    for (const code of ["resource_identifier", "recipient_identifier"]) {
      expect(q[`missing_${code}`]?.type).toBe("noul");
    }
  });

  it("marks the agent justification as untrusted testimony, never as the operation's real description", () => {
    // The registry's own trusted preconditions/effects are what the instructions reference by name; the agent's
    // justification never appears inside any question's own instructions text.
    const q = buildNecessityQuestions(baseInput());
    expect(q.classification.instructions).not.toContain("I need a branch");
  });
});

describe("mapNecessityAnswers", () => {
  it("maps a well-formed choice+noul answer bundle into the typed evaluation", () => {
    const input = baseInput();
    const answers = {
      classification: { type: "choice", choice: "required", confidence: 0.87, probabilities: {} },
      reason_direct_task_requirement: { type: "noul", noul: 0.9 },
      reason_duplicate_operation: { type: "noul", noul: 0.1 },
      predecessor_read: { type: "noul", noul: 0.95 },
    };
    const result = mapNecessityAnswers(input, answers);
    expect(result).toMatchObject({
      classification: "required",
      confidence: 0.87,
      requiredPredecessorNodeIds: ["read"],
    });
    expect(result.reasonCodes).toContain("direct_task_requirement");
    expect(result.reasonCodes).not.toContain("duplicate_operation");
  });

  it("never treats an unparseable classification as required — falls back to ambiguous", () => {
    const result = mapNecessityAnswers(baseInput(), {
      classification: { type: "choice", choice: "yes_do_it", confidence: 0.99 },
    });
    expect(result.classification).toBe("ambiguous");
  });

  it("never selects a predecessor or alternative id outside the supplied allowlists, even if the answer bundle names one", () => {
    // A malformed/adversarial answer bundle naming an out-of-allowlist key must simply be ignored — mapNecessityAnswers
    // only ever reads keys it itself asked for, derived from the allowlists.
    const result = mapNecessityAnswers(baseInput(), {
      classification: { type: "choice", choice: "required", confidence: 0.5 },
      "predecessor_some-other-node": { type: "noul", noul: 1 },
      "alternative_github.delete_repository": { type: "noul", noul: 1 },
    });
    expect(result.requiredPredecessorNodeIds).toEqual([]);
    expect(result.alternativeOperationIds).toEqual([]);
  });

  it("defaults confidence to 0 and every list to empty when the response is entirely empty", () => {
    const result = mapNecessityAnswers(baseInput(), {});
    expect(result).toEqual({
      classification: "ambiguous",
      confidence: 0,
      reasonCodes: [],
      requiredPredecessorNodeIds: [],
      missingInformationCodes: [],
      alternativeOperationIds: [],
    });
  });
});

describe("MockNecessityProvider (clearly labeled, not live Jev)", () => {
  const provider = new MockNecessityProvider();
  it("is named distinctly so it can never be mistaken for a live Jev result", () => {
    expect(provider.name).toBe("mock");
    expect(provider.model).toContain("mock");
  });

  it("flags a duplicate read that nothing consumes as unjustified", async () => {
    const input = baseInput({
      plan: [
        { id: "a", tool: "github.get_issue", sideEffect: "read", dependencies: [], dataFlowFromNodeIds: [] },
        { id: "b", tool: "github.get_issue", sideEffect: "read", dependencies: [], dataFlowFromNodeIds: [] },
      ],
      nodeId: "b",
      inBackwardSlice: true,
    });
    const result = await provider.evaluate(input, { signal: new AbortController().signal });
    expect(result.classification).toBe("unjustified");
    expect(result.reasonCodes).toContain("duplicate_operation");
  });

  it("flags a node outside the backward slice with nothing depending on it as unjustified", async () => {
    const input = baseInput({ inBackwardSlice: false });
    const result = await provider.evaluate(input, { signal: new AbortController().signal });
    expect(result.classification).toBe("unjustified");
  });

  it("classifies an ordinary required call as required with the direct_task_requirement reason", async () => {
    const result = await provider.evaluate(baseInput(), { signal: new AbortController().signal });
    expect(result.classification).toBe("required");
    expect(result.reasonCodes).toContain("direct_task_requirement");
  });
});

describe("runNecessityEvaluation", () => {
  const okProvider: JevNecessityProvider = {
    name: "mock",
    model: "m",
    modelVersion: "v1",
    evaluate: async () => ({
      classification: "required",
      confidence: 0.9,
      reasonCodes: [],
      requiredPredecessorNodeIds: [],
      missingInformationCodes: [],
      alternativeOperationIds: [],
    }),
  };

  it("resolves ok with the evaluation on success", async () => {
    const result = await runNecessityEvaluation({ provider: okProvider, input: baseInput() });
    expect(result.state).toBe("ok");
    expect(result.evaluation?.classification).toBe("required");
  });

  it("never throws, and never returns evaluation on unavailable/timeout/error", async () => {
    const unavailable: JevNecessityProvider = {
      ...okProvider,
      evaluate: async () => {
        throw new JevProviderUnavailableError("no key");
      },
    };
    const r1 = await runNecessityEvaluation({ provider: unavailable, input: baseInput() });
    expect(r1).toMatchObject({ state: "unavailable", evaluation: null });

    const erroring: JevNecessityProvider = {
      ...okProvider,
      evaluate: async () => {
        throw new JevProviderError("malformed_output", "bad");
      },
    };
    const r2 = await runNecessityEvaluation({ provider: erroring, input: baseInput() });
    expect(r2).toMatchObject({ state: "error", evaluation: null, errorCategory: "malformed_output" });

    const hanging: JevNecessityProvider = { ...okProvider, evaluate: () => new Promise(() => undefined) };
    const r3 = await runNecessityEvaluation({ provider: hanging, input: baseInput(), timeoutMs: 20 });
    expect(r3).toMatchObject({ state: "timeout", evaluation: null });
  });

  it("respects an open circuit breaker without calling the provider", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure();
    const spy = vi.fn(okProvider.evaluate);
    const result = await runNecessityEvaluation({
      provider: { ...okProvider, evaluate: spy },
      input: baseInput(),
      breaker,
    });
    expect(result.state).toBe("circuit_open");
    expect(spy).not.toHaveBeenCalled();
  });
});
