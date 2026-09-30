import "server-only";

import { callDecisions } from "@/lib/openrouter/client";
import { OpenRouterError, OpenRouterUnavailableError } from "@/lib/openrouter/errors";
import { getOpenRouterEnv } from "@/lib/openrouter/env";

import {
  buildRiskQuestions,
  mapRiskAnswers,
  type JevRiskProvider,
  type RiskEvaluationInput,
} from "./risk-provider";
import { JevProviderError, JevProviderUnavailableError, type ToolRiskEvaluation } from "./types";

export const OPENROUTER_JEV_RISK_PROVIDER_VERSION = "authority-openrouter-jev-risk-provider-2026-09-29";

function buildState(input: RiskEvaluationInput) {
  return {
    taskIntent: input.taskIntent,
    tool: input.tool,
    operation: input.operation,
    resource: input.resource,
    argumentKeys: input.argumentKeys,
    contractAllowedTools: input.contractAllowedTools,
    inProposedPlan: input.inProposedPlan,
    expectedPlanNodeId: input.expectedPlanNodeId,
    priorCalls: input.priorCallSummaries,
    remainingInvocations: input.remainingInvocations,
    contractExpiresInSeconds: input.contractExpiresInSeconds,
  };
}

export class OpenRouterJevRiskProvider implements JevRiskProvider {
  readonly name = "openrouter";
  readonly model: string;
  readonly modelVersion = OPENROUTER_JEV_RISK_PROVIDER_VERSION;

  constructor(private readonly timeoutMs = 800) {
    const env = getOpenRouterEnv();
    if (!env?.jevDecisionModel) {
      throw new JevProviderUnavailableError(
        "OPENROUTER_JEV_DECISION_MODEL is not configured; direct-Jev runtime risk evaluation is unavailable.",
      );
    }
    this.model = env.jevDecisionModel;
  }

  async evaluate(input: RiskEvaluationInput, call: { signal: AbortSignal }): Promise<ToolRiskEvaluation> {
    const env = getOpenRouterEnv();
    if (!env?.jevDecisionModel)
      throw new JevProviderUnavailableError("OPENROUTER_JEV_DECISION_MODEL is not configured");

    try {
      const result = await callDecisions({
        model: env.jevDecisionModel,
        state: buildState(input),
        questions: buildRiskQuestions(),
        timeoutMs: this.timeoutMs,
        signal: call.signal,
      });
      return mapRiskAnswers(result.answers);
    } catch (error) {
      if (error instanceof OpenRouterUnavailableError) throw new JevProviderUnavailableError(error.message);
      if (error instanceof OpenRouterError)
        throw new JevProviderError(error.category, error.message, { cause: error });
      throw new JevProviderError("provider_error", error instanceof Error ? error.message : String(error));
    }
  }
}
