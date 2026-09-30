import "server-only";

import { z } from "zod";

import { candidatePlanSchema } from "@/lib/domain";
import { callChatCompletions } from "@/lib/openrouter/client";
import {
  OpenRouterError,
  OpenRouterOutputTooLargeError,
  OpenRouterTimeoutError,
  OpenRouterUnavailableError,
} from "@/lib/openrouter/errors";
import { getOpenRouterEnv } from "@/lib/openrouter/env";

import {
  PlanProposalOutputTooLargeError,
  PlanProposalProviderError,
  PlanProposalTimeoutError,
  type PlanProposalProvider,
  type PlanProposalResult,
  type TrustedTaskInput,
} from "./plan-proposal-provider";

export const OPENROUTER_JEV_ROUTER_PROVIDER_VERSION = "authority-openrouter-jev-router-provider-2026-09-29";

/**
 * Candidate-plan proposal through OpenRouter's `typesafe/jev-router` (role A — see docs/jev/OVERVIEW.md). Structurally
 * identical in spirit to `OpenAiPlanProposalProvider`: one chat-completions-shaped call, structured JSON requested,
 * and — critically — the raw response is returned as `unknown` and the caller (`generatePlanWithAiAction`) still
 * re-validates it against `candidatePlanSchema` regardless of what this provider or OpenRouter claims. That
 * unconditional re-validation is what makes it safe to use jev-router here even though its own structured-output
 * support could not be confirmed from OpenRouter's published model metadata at implementation time (its declared
 * `supported_parameters` list is empty and it has no listed provider endpoints — see docs/jev/OVERVIEW.md's
 * verification notes). A non-conforming response surfaces as an ordinary "AI plan generation failed" to the human
 * reviewer; it is never silently accepted or substituted with a mock.
 */
const CANDIDATE_PLAN_JSON_SCHEMA = z.toJSONSchema(candidatePlanSchema);

const SYSTEM_PROMPT = [
  "You propose a structured execution plan for an AI agent. You are not trusted:",
  "every plan you produce is independently re-validated, minimized to the least",
  "authority it needs, and compiled into a contract by deterministic code that",
  "does not read anything you write beyond the plan's structure. You cannot",
  "grant permissions, approve anything, or bypass an organization's policies.",
  "Only use tools named in the provided tool list, with exactly their argument",
  "schema. Never invent a tool. If the task cannot be accomplished with the",
  "given tools, propose the closest safe subset rather than fabricating a tool.",
  "Respond with JSON matching the provided schema and nothing else.",
].join(" ");

function buildUserPrompt(input: TrustedTaskInput): string {
  return JSON.stringify(
    {
      taskId: input.taskId,
      taskIntent: input.taskIntent,
      availableTools: input.availableTools,
      activeOrganizationPolicies: input.policySummaries,
      resourceReferences: input.resourceReferences,
    },
    null,
    2,
  );
}

const DEFAULT_TIMEOUT_MS = 20_000;

export class OpenRouterJevRouterPlanProposalProvider implements PlanProposalProvider {
  constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  async proposePlan(input: TrustedTaskInput): Promise<PlanProposalResult> {
    const env = getOpenRouterEnv();
    if (!env) {
      throw new PlanProposalProviderError(
        "OPENROUTER_API_KEY is not configured; AI-assisted plan generation via OpenRouter is unavailable.",
      );
    }

    let result;
    try {
      result = await callChatCompletions({
        model: env.planModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input) },
        ],
        responseFormat: {
          type: "json_schema",
          json_schema: { name: "candidate_plan", schema: CANDIDATE_PLAN_JSON_SCHEMA, strict: false },
        },
        timeoutMs: this.timeoutMs,
        providerRouting:
          env.denyDataCollection || env.zdrOnly
            ? {
                ...(env.denyDataCollection ? { data_collection: "deny" as const } : {}),
                ...(env.zdrOnly ? { zdr: true } : {}),
              }
            : undefined,
      });
    } catch (error) {
      if (error instanceof OpenRouterTimeoutError) throw new PlanProposalTimeoutError(error.message);
      if (error instanceof OpenRouterOutputTooLargeError)
        throw new PlanProposalOutputTooLargeError(error.message);
      if (error instanceof OpenRouterUnavailableError) throw new PlanProposalProviderError(error.message);
      if (error instanceof OpenRouterError)
        throw new PlanProposalProviderError(`OpenRouter (${error.category}): ${error.message}`);
      throw new PlanProposalProviderError(
        `OpenRouter plan proposal failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    let plan: unknown;
    try {
      plan = JSON.parse(result.content);
    } catch {
      throw new PlanProposalProviderError("OpenRouter message content was not valid JSON");
    }

    return {
      plan,
      metadata: {
        provider: "openrouter",
        model: env.planModel,
        providerVersion: OPENROUTER_JEV_ROUTER_PROVIDER_VERSION,
        respondedModel: result.respondedModel ?? undefined,
      },
    };
  }
}
