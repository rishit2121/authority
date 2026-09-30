import "server-only";

import type { JevRiskProvider, RiskEvaluationInput } from "./risk-provider";
import type { JevRiskCategory, ToolRiskEvaluation } from "./types";

export const MOCK_RISK_PROVIDER_VERSION = "authority-mock-jev-risk-provider-2026-09-29";

/**
 * A deterministic, rule-based stand-in for direct Jev risk evaluation — tests and local exploration only, mirroring
 * `MockNecessityProvider`'s honesty rules (never selected in production, never mistaken for a live result).
 */
export class MockRiskProvider implements JevRiskProvider {
  readonly name = "mock";
  readonly model = "mock-risk-heuristic";
  readonly modelVersion = MOCK_RISK_PROVIDER_VERSION;

  async evaluate(input: RiskEvaluationInput, _call: { signal: AbortSignal }): Promise<ToolRiskEvaluation> {
    const categories: JevRiskCategory[] = [];
    let riskClass: ToolRiskEvaluation["riskClass"] = "low";

    if (!input.contractAllowedTools.includes(input.tool)) {
      categories.push("task_divergence");
      riskClass = "high";
    }
    if (!input.inProposedPlan) {
      categories.push("suspicious_sequence");
      if (riskClass === "low") riskClass = "medium";
    }
    if (input.remainingInvocations !== null && input.remainingInvocations <= 0) {
      categories.push("capability_misuse");
      riskClass = "critical";
    }

    return {
      riskClass,
      confidence: 0.5,
      categories: categories.length > 0 ? categories : ["none"],
      evidenceCodes: input.inProposedPlan ? [] : ["operation_not_in_plan"],
    };
  }
}
