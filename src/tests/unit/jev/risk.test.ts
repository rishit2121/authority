import { describe, expect, it, vi } from "vitest";

import { CircuitBreaker } from "@/lib/semantic/circuit-breaker";
import { buildRiskQuestions, mapRiskAnswers, type RiskEvaluationInput } from "@/lib/jev/risk-provider";
import { MockRiskProvider } from "@/lib/jev/mock-risk-provider";
import { runRiskEvaluation } from "@/lib/jev/risk-runner";
import { JevProviderError, JevProviderUnavailableError } from "@/lib/jev/types";
import type { JevRiskProvider } from "@/lib/jev/risk-provider";

const baseInput = (over: Partial<RiskEvaluationInput> = {}): RiskEvaluationInput => ({
  taskIntent: "Send the receipt to maya@example.com",
  tool: "gmail.send_email",
  operation: "send_email",
  resource: null,
  argumentKeys: ["to", "subject"],
  contractAllowedTools: ["gmail.send_email"],
  inProposedPlan: true,
  expectedPlanNodeId: "n1",
  priorCallSummaries: [],
  remainingInvocations: 1,
  contractExpiresInSeconds: 300,
  ...over,
});

describe("buildRiskQuestions", () => {
  it("has exactly one choice (riskClass) and a noul per category (excluding none) and evidence code", () => {
    const q = buildRiskQuestions();
    expect(q.riskClass.type).toBe("choice");
    expect(Object.keys(q.riskClass.criteria!)).toEqual(["low", "medium", "high", "critical"]);
    expect(q.category_none).toBeUndefined();
    expect(q.category_prompt_injection.type).toBe("noul");
    expect(q.evidence_operation_not_in_plan.type).toBe("noul");
  });
});

describe("mapRiskAnswers", () => {
  it("maps a well-formed answer bundle", () => {
    const result = mapRiskAnswers({
      riskClass: { type: "choice", choice: "high", confidence: 0.8 },
      category_recipient_substitution: { type: "noul", noul: 0.9 },
      evidence_recipient_differs_from_plan: { type: "noul", noul: 0.9 },
    });
    expect(result.riskClass).toBe("high");
    expect(result.confidence).toBe(0.8);
    expect(result.categories).toEqual(["recipient_substitution"]);
    expect(result.evidenceCodes).toEqual(["recipient_differs_from_plan"]);
  });

  it("never treats an unparseable risk class as low — fails toward high, not toward safety-through-silence", () => {
    expect(
      mapRiskAnswers({ riskClass: { type: "choice", choice: "unknown", confidence: 0.5 } }).riskClass,
    ).toBe("high");
    expect(mapRiskAnswers({}).riskClass).toBe("high");
  });

  it('reports categories as exactly ["none"] when nothing was flagged', () => {
    const result = mapRiskAnswers({ riskClass: { type: "choice", choice: "low", confidence: 0.9 } });
    expect(result.categories).toEqual(["none"]);
  });
});

describe("MockRiskProvider (clearly labeled, not live Jev)", () => {
  const provider = new MockRiskProvider();
  it("is named distinctly", () => {
    expect(provider.name).toBe("mock");
  });

  it("flags a tool outside the contract's allowed tools as high risk", async () => {
    const input = baseInput({ contractAllowedTools: ["github.get_issue"] });
    const result = await provider.evaluate(input, { signal: new AbortController().signal });
    expect(result.riskClass).toBe("high");
    expect(result.categories).toContain("task_divergence");
  });

  it("flags an exhausted budget as critical", async () => {
    const result = await provider.evaluate(baseInput({ remainingInvocations: 0 }), {
      signal: new AbortController().signal,
    });
    expect(result.riskClass).toBe("critical");
  });

  it("an ordinary in-plan call is low risk", async () => {
    const result = await provider.evaluate(baseInput(), { signal: new AbortController().signal });
    expect(result.riskClass).toBe("low");
    expect(result.categories).toEqual(["none"]);
  });
});

describe("runRiskEvaluation", () => {
  const okProvider: JevRiskProvider = {
    name: "mock",
    model: "m",
    modelVersion: "v1",
    evaluate: async () => ({ riskClass: "low", confidence: 0.9, categories: ["none"], evidenceCodes: [] }),
  };

  it("resolves ok with the evaluation", async () => {
    const result = await runRiskEvaluation({ provider: okProvider, input: baseInput() });
    expect(result).toMatchObject({ state: "ok" });
    expect(result.evaluation?.riskClass).toBe("low");
  });

  it("never throws on unavailable/error/timeout, and evaluation is always null on failure", async () => {
    const unavailable: JevRiskProvider = {
      ...okProvider,
      evaluate: async () => {
        throw new JevProviderUnavailableError("no key");
      },
    };
    expect(await runRiskEvaluation({ provider: unavailable, input: baseInput() })).toMatchObject({
      state: "unavailable",
      evaluation: null,
    });

    const erroring: JevRiskProvider = {
      ...okProvider,
      evaluate: async () => {
        throw new JevProviderError("malformed_output", "bad");
      },
    };
    expect(await runRiskEvaluation({ provider: erroring, input: baseInput() })).toMatchObject({
      state: "error",
      evaluation: null,
    });

    const hanging: JevRiskProvider = { ...okProvider, evaluate: () => new Promise(() => undefined) };
    expect(await runRiskEvaluation({ provider: hanging, input: baseInput(), timeoutMs: 20 })).toMatchObject({
      state: "timeout",
      evaluation: null,
    });
  });

  it("respects an open circuit breaker without calling the provider", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure();
    const spy = vi.fn(okProvider.evaluate);
    const result = await runRiskEvaluation({
      provider: { ...okProvider, evaluate: spy },
      input: baseInput(),
      breaker,
    });
    expect(result.state).toBe("circuit_open");
    expect(spy).not.toHaveBeenCalled();
  });
});
