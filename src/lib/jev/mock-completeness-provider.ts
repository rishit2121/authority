import "server-only";

import type { CompletenessEvaluationInput, JevCompletenessProvider } from "./completeness-provider";
import type { PlanCompletenessEvaluation } from "./types";

export const MOCK_COMPLETENESS_PROVIDER_VERSION = "authority-mock-jev-completeness-provider-2026-09-29";

/** Deterministic stand-in for tests/local exploration only — never a live Jev result (see mock-necessity-provider.ts). */
export class MockCompletenessProvider implements JevCompletenessProvider {
  readonly name = "mock";
  readonly model = "mock-completeness-heuristic";
  readonly modelVersion = MOCK_COMPLETENESS_PROVIDER_VERSION;

  async evaluate(
    input: CompletenessEvaluationInput,
    _call: { signal: AbortSignal },
  ): Promise<PlanCompletenessEvaluation> {
    const sideEffects = new Set(input.plan.map((n) => n.sideEffect));
    if (sideEffects.has("read") && sideEffects.size === 1 && input.plan.length > 0) {
      return {
        classification: "missing_capability_category",
        confidence: 0.5,
        possibleMissingOperationIds: input.candidateOperationIds.slice(0, 1),
      };
    }
    return { classification: "complete", confidence: 0.5, possibleMissingOperationIds: [] };
  }
}
