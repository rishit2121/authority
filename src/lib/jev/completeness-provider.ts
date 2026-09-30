import "server-only";

import type { DecisionQuestion } from "@/lib/openrouter/client";

import {
  COMPLETENESS_CLASSIFICATIONS,
  type JevProviderIdentity,
  type PlanCompletenessEvaluation,
} from "./types";
import type { NecessityPlanNodeSummary } from "./necessity-provider";

/**
 * Plan-level completeness (section 4 — see docs/jev/OVERVIEW.md). Per-tool necessity can only judge tools that are
 * IN the plan; it cannot notice a step the plan never proposed at all. This is a separate evaluation for exactly
 * that gap.
 *
 * `candidateOperationIds` is Authority's own allowlist — every provider already used by at least one node in the
 * plan, so a "possibly missing" suggestion is always a real, registry-known, contextually-relevant operation, never
 * an invented tool and never the entire registry. Any operation this surfaces still has to pass registry
 * resolution, policy checks, mechanical validation and its own per-tool necessity evaluation before it could ever be
 * added to a contract — this evaluation only ever *suggests looking at* an operation, never adds one itself.
 */
export interface CompletenessEvaluationInput {
  taskIntent: string;
  plan: NecessityPlanNodeSummary[];
  candidateOperationIds: string[];
  activePolicySummaries: string[];
}

export interface JevCompletenessProvider extends JevProviderIdentity {
  evaluate(
    input: CompletenessEvaluationInput,
    call: { signal: AbortSignal },
  ): Promise<PlanCompletenessEvaluation>;
}

export function buildCompletenessQuestions(
  input: CompletenessEvaluationInput,
): Record<string, DecisionQuestion> {
  const questions: Record<string, DecisionQuestion> = {
    classification: {
      type: "choice",
      instructions: "Given the trusted task and the complete proposed plan, is the plan complete?",
      criteria: {
        complete:
          "The plan's steps, together, accomplish the trusted task with nothing missing or extraneous in kind.",
        missing_information:
          "The trusted task itself is too incomplete to tell whether the plan is sufficient.",
        missing_capability_category:
          "The plan is missing a whole category of action the task needs (e.g. it reads but never writes the result the task asked for).",
        internally_inconsistent: "The plan's own steps conflict with or duplicate each other.",
        unnecessarily_privileged:
          "The plan accomplishes the task but through a more privileged path than necessary.",
      },
    },
  };
  for (const opId of input.candidateOperationIds) {
    questions[`missing_${opId}`] = {
      type: "noul",
      instructions: `Is "${opId}" plausibly a step the trusted task needs that the plan does not currently include?`,
    };
  }
  return questions;
}

export function mapCompletenessAnswers(
  input: CompletenessEvaluationInput,
  answers: Record<string, unknown>,
): PlanCompletenessEvaluation {
  const classificationAnswer = answers.classification as
    { choice?: unknown; confidence?: unknown } | undefined;
  const classification = COMPLETENESS_CLASSIFICATIONS.includes(classificationAnswer?.choice as never)
    ? (classificationAnswer!.choice as PlanCompletenessEvaluation["classification"])
    : "missing_information"; // an unparseable result is never treated as "complete"
  const confidence =
    typeof classificationAnswer?.confidence === "number" ? clamp01(classificationAnswer.confidence) : 0;
  const yes = (key: string): boolean =>
    (answers[key] as { noul?: unknown } | undefined)?.noul !== undefined
      ? Number((answers[key] as { noul: unknown }).noul) >= 0.5
      : false;
  const possibleMissingOperationIds = input.candidateOperationIds.filter((id) => yes(`missing_${id}`));
  return { classification, confidence, possibleMissingOperationIds };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
