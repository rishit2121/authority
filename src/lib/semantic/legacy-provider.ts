import type { SemanticRiskInput } from "@/lib/domain";
import { MockSemanticDecisionProvider } from "@/lib/authorization/mock-semantic-decision-provider";

import type { SemanticProviderCall, SemanticRiskProvider } from "./provider";

/**
 * Adapts the original Part 1 `SemanticDecisionProvider` (a lexical-overlap
 * heuristic) onto the Part 5 port. It is a deliberately different, simpler
 * opinion than `MockSemanticRiskProvider`, which is what makes
 * provider-to-provider disagreement measurable in the evaluation suite. It
 * has no prompt-injection or argument-change signal at all, so those report 0.
 */
export class LegacyLexicalProvider implements SemanticRiskProvider {
  readonly name = "legacy_lexical";
  readonly model = "lexical-overlap";
  readonly modelVersion = "0.1.0";

  private readonly inner = new MockSemanticDecisionProvider({ latencyMs: 1 });

  async evaluate(input: SemanticRiskInput, _call: SemanticProviderCall): Promise<unknown> {
    void _call;
    const result = await this.inner.evaluate({
      taskId: "shadow",
      taskIntent: input.taskIntent,
      tool: input.tool,
      arguments: input.arguments,
      contractAllowedTools: input.contractAllowedTools,
      priorPlanTools: input.priorCalls.map((c) => c.tool),
    });
    return {
      signals: {
        taskAlignment: result.taskRelevanceProbability,
        resourceRelevance: result.resourceRelevanceProbability,
        scopeExpansion: result.scopeExpansionProbability,
        externalDisclosure: result.externalDisclosureProbability,
        promptInjection: 0,
        suspiciousArgumentChange: 0,
        planDeviation: Number((1 - result.planConsistencyProbability).toFixed(4)),
      },
      indicators: [],
      confidence: result.overallConfidence,
    };
  }
}
