import "server-only";

import { callDecisions } from "@/lib/openrouter/client";
import { OpenRouterError, OpenRouterUnavailableError } from "@/lib/openrouter/errors";
import { getOpenRouterEnv } from "@/lib/openrouter/env";

import {
  buildCompletenessQuestions,
  mapCompletenessAnswers,
  type CompletenessEvaluationInput,
  type JevCompletenessProvider,
} from "./completeness-provider";
import { JevProviderError, JevProviderUnavailableError, type PlanCompletenessEvaluation } from "./types";

export const OPENROUTER_JEV_COMPLETENESS_PROVIDER_VERSION =
  "authority-openrouter-jev-completeness-provider-2026-09-29";

export class OpenRouterJevCompletenessProvider implements JevCompletenessProvider {
  readonly name = "openrouter";
  readonly model: string;
  readonly modelVersion = OPENROUTER_JEV_COMPLETENESS_PROVIDER_VERSION;

  constructor(private readonly timeoutMs = 15_000) {
    const env = getOpenRouterEnv();
    if (!env?.jevDecisionModel)
      throw new JevProviderUnavailableError("OPENROUTER_JEV_DECISION_MODEL is not configured");
    this.model = env.jevDecisionModel;
  }

  async evaluate(
    input: CompletenessEvaluationInput,
    call: { signal: AbortSignal },
  ): Promise<PlanCompletenessEvaluation> {
    const env = getOpenRouterEnv();
    if (!env?.jevDecisionModel)
      throw new JevProviderUnavailableError("OPENROUTER_JEV_DECISION_MODEL is not configured");
    try {
      const result = await callDecisions({
        model: env.jevDecisionModel,
        state: {
          taskIntent: input.taskIntent,
          plan: input.plan,
          activeOrganizationPolicies: input.activePolicySummaries,
        },
        questions: buildCompletenessQuestions(input),
        timeoutMs: this.timeoutMs,
        signal: call.signal,
      });
      return mapCompletenessAnswers(input, result.answers);
    } catch (error) {
      if (error instanceof OpenRouterUnavailableError) throw new JevProviderUnavailableError(error.message);
      if (error instanceof OpenRouterError)
        throw new JevProviderError(error.category, error.message, { cause: error });
      throw new JevProviderError("provider_error", error instanceof Error ? error.message : String(error));
    }
  }
}
