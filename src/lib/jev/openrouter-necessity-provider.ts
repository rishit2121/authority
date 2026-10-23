import "server-only";

import { callDecisions } from "@/lib/openrouter/client";
import { OpenRouterError, OpenRouterUnavailableError } from "@/lib/openrouter/errors";
import { getOpenRouterEnv } from "@/lib/openrouter/env";

import {
  buildNecessityQuestions,
  mapNecessityAnswers,
  type JevNecessityProvider,
  type NecessityEvaluationInput,
} from "./necessity-provider";
import { JevProviderError, JevProviderUnavailableError, type ToolNecessityEvaluation } from "./types";

export const OPENROUTER_JEV_NECESSITY_PROVIDER_VERSION =
  "authority-openrouter-jev-necessity-provider-2026-10-23";

/** The trusted JSON context ("state") Jev evaluates — structure only, no raw argument values (see necessity-provider.ts). */
function buildState(input: NecessityEvaluationInput) {
  return {
    taskIntent: input.taskIntent,
    plan: input.plan,
    evaluatingNodeId: input.nodeId,
    // No backward-slice flag: it is true for every node of a validated plan, so presenting it as "mechanical"
    // evidence would tell the model something had checked necessity when nothing had.
    registryOperation: {
      id: input.registryOperation.id,
      provider: input.registryOperation.provider,
      sideEffect: input.registryOperation.sideEffect,
      resourceType: input.registryOperation.resourceType,
      dataSensitivity: input.registryOperation.dataSensitivity,
      trustedPreconditions: input.registryOperation.preconditions,
      trustedEffects: input.registryOperation.effects,
    },
    activeOrganizationPolicies: input.activePolicySummaries,
    // Explicitly labeled untrusted in the state itself, not only in code comments, since this is what the model reads.
    untrustedAgentJustification: input.agentJustification,
  };
}

export class OpenRouterJevNecessityProvider implements JevNecessityProvider {
  readonly name = "openrouter";
  readonly model: string;
  readonly modelVersion = OPENROUTER_JEV_NECESSITY_PROVIDER_VERSION;

  constructor(private readonly timeoutMs = 15_000) {
    const env = getOpenRouterEnv();
    if (!env?.jevDecisionModel) {
      throw new JevProviderUnavailableError(
        "OPENROUTER_JEV_DECISION_MODEL is not configured; direct-Jev necessity evaluation is unavailable.",
      );
    }
    this.model = env.jevDecisionModel;
  }

  async evaluate(
    input: NecessityEvaluationInput,
    call: { signal: AbortSignal },
  ): Promise<ToolNecessityEvaluation> {
    const env = getOpenRouterEnv();
    if (!env?.jevDecisionModel)
      throw new JevProviderUnavailableError("OPENROUTER_JEV_DECISION_MODEL is not configured");

    try {
      const result = await callDecisions({
        model: env.jevDecisionModel,
        state: buildState(input),
        questions: buildNecessityQuestions(input),
        timeoutMs: this.timeoutMs,
        signal: call.signal,
      });
      return mapNecessityAnswers(input, result.answers);
    } catch (error) {
      if (error instanceof OpenRouterUnavailableError) throw new JevProviderUnavailableError(error.message);
      if (error instanceof OpenRouterError)
        throw new JevProviderError(error.category, error.message, { cause: error });
      throw new JevProviderError("provider_error", error instanceof Error ? error.message : String(error));
    }
  }
}
