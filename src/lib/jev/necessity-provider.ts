import "server-only";

import type { DecisionQuestion } from "@/lib/openrouter/client";

import {
  MISSING_INFORMATION_CODES,
  NECESSITY_CLASSIFICATIONS,
  NECESSITY_REASON_CODES,
  type JevProviderIdentity,
  type MissingInformationCode,
  type NecessityReasonCode,
  type ToolNecessityEvaluation,
} from "./types";

/**
 * Per-tool necessity verification input (role B — see docs/jev/OVERVIEW.md).
 *
 * Deliberately excludes raw argument VALUES: necessity is a question about plan *structure* (is this operation, on
 * this resource role, needed at all), which mechanical validation's argument-type/policy checks already cover
 * separately — sending literal argument values to a third-party model at plan-authoring time buys nothing here and
 * widens what leaves the process for no benefit.
 *
 * `agentJustification` is the ONLY field on this type that is not Authority's own trusted data; it is passed through
 * unmodified and unlabeled-as-fact in the prompt precisely so Jev can weigh it as testimony, never as the operation's
 * real description (the registry's `preconditions`/`effects` are that).
 */
export interface NecessityPlanNodeSummary {
  id: string;
  tool: string;
  sideEffect: string;
  dependencies: string[];
  dataFlowFromNodeIds: string[];
}

export interface NecessityRegistryOperationSummary {
  id: string;
  provider: string;
  sideEffect: string;
  resourceType: string;
  dataSensitivity: string;
  preconditions: string[];
  effects: string[];
  /** The exact, complete allowlist Jev may choose `alternativeOperationIds` from — never invented, never extended. */
  alternativeOperationIds: string[];
}

export interface NecessityEvaluationInput {
  taskId: string;
  taskIntent: string;
  plan: NecessityPlanNodeSummary[];
  nodeId: string;
  /**
   * Whether the structural backward slice reaches this node. True for every node of a validated plan (see
   * `lib/authorization/backward-slice.ts`), so it carries no necessity information and is not sent to the model.
   */
  inBackwardSlice: boolean;
  registryOperation: NecessityRegistryOperationSummary;
  activePolicySummaries: string[];
  agentJustification: string | null;
}

export interface JevNecessityProvider extends JevProviderIdentity {
  /** Returns Authority's typed evaluation directly — the provider owns mapping from Jev's raw choice/noul answers. */
  evaluate(input: NecessityEvaluationInput, call: { signal: AbortSignal }): Promise<ToolNecessityEvaluation>;
}

/**
 * Builds the exact bundle of typed Decisions-API questions for one node. One `choice` for the classification, then a
 * fixed set of `noul` sub-questions for reason codes and missing-information codes, plus one `noul` per node already
 * in this node's own `dependencies` (never any other node — that allowlist is what makes `requiredPredecessorNodeIds`
 * safe) and one `noul` per registry-curated `alternativeOperationIds` entry. Jev's typed primitives cannot return a
 * free-form array, so a "select some subset of an allowlist" instruction is expressed as one yes/no question per
 * allowlisted item rather than forced into an incompatible list-valued schema.
 */
export function buildNecessityQuestions(input: NecessityEvaluationInput): Record<string, DecisionQuestion> {
  const node = input.plan.find((n) => n.id === input.nodeId);
  const questions: Record<string, DecisionQuestion> = {
    classification: {
      type: "choice",
      instructions:
        "Is this tool call genuinely necessary for the user's trusted task, given the complete plan and this operation's trusted definition?",
      criteria: {
        required: "The task cannot be accomplished without this exact operation.",
        conditional: "Necessary only if a specific, checkable condition holds; otherwise it should not run.",
        unjustified:
          "The task can be accomplished without this operation; it adds authority the task does not need.",
        ambiguous: "There is not enough trusted information to tell either way.",
      },
    },
  };
  for (const code of NECESSITY_REASON_CODES) {
    questions[`reason_${code}`] = { type: "noul", instructions: reasonCodeQuestion(code) };
  }
  for (const code of MISSING_INFORMATION_CODES) {
    questions[`missing_${code}`] = { type: "noul", instructions: missingInfoQuestion(code) };
  }
  for (const depId of node?.dependencies ?? []) {
    questions[`predecessor_${depId}`] = {
      type: "noul",
      instructions: `Is the plan node "${depId}" a required predecessor of this operation (this operation cannot be justified without it having already run)?`,
    };
  }
  for (const altId of input.registryOperation.alternativeOperationIds) {
    questions[`alternative_${altId}`] = {
      type: "noul",
      instructions: `Would "${altId}" be an adequate, less-privileged substitute for this operation, given the trusted task?`,
    };
  }
  return questions;
}

function reasonCodeQuestion(code: NecessityReasonCode): string {
  const text: Record<NecessityReasonCode, string> = {
    direct_task_requirement: "Does the trusted task intent directly and explicitly call for this operation?",
    required_dependency:
      "Is this operation required only because a later, genuinely necessary step depends on it?",
    required_data_source:
      "Is this operation the task's only trusted source for data another required step needs?",
    required_side_effect: "Is this operation's side effect itself the thing the trusted task asked for?",
    duplicate_operation: "Does this operation repeat an effect another node in the plan already produces?",
    unrelated_resource: "Does this operation target a resource the trusted task never named or implied?",
    unrequested_side_effect:
      "Does this operation cause a side effect (e.g. a notification, write or deletion) the task never asked for?",
    less_privileged_alternative: "Could a less-privileged operation achieve the same trusted objective?",
    missing_task_information:
      "Is the task's own intent too incomplete to justify or rule out this operation?",
    plan_dependency_conflict:
      "Does this operation conflict with, or duplicate, what an earlier plan node already establishes?",
  };
  return text[code];
}

function missingInfoQuestion(code: MissingInformationCode): string {
  const text: Record<MissingInformationCode, string> = {
    resource_identifier:
      "Is it unclear, from the trusted task alone, exactly which resource this should act on?",
    recipient_identifier:
      "Is it unclear, from the trusted task alone, exactly who the intended recipient is?",
    amount_or_quantity:
      "Is it unclear, from the trusted task alone, exactly what amount or quantity is intended?",
    target_branch_or_environment:
      "Is it unclear, from the trusted task alone, which branch or environment this should target?",
    time_window: "Is it unclear, from the trusted task alone, what time window or deadline applies?",
  };
  return text[code];
}

/** Maps Jev's raw typed answers back into Authority's `ToolNecessityEvaluation` — never trusts a value Jev did not actually return in the expected shape. */
export function mapNecessityAnswers(
  input: NecessityEvaluationInput,
  answers: Record<string, unknown>,
): ToolNecessityEvaluation {
  const node = input.plan.find((n) => n.id === input.nodeId);
  const classificationAnswer = answers.classification as
    { choice?: unknown; confidence?: unknown } | undefined;
  const classification = NECESSITY_CLASSIFICATIONS.includes(classificationAnswer?.choice as never)
    ? (classificationAnswer!.choice as ToolNecessityEvaluation["classification"])
    : "ambiguous"; // an unparseable classification is never silently treated as "required"
  const confidence =
    typeof classificationAnswer?.confidence === "number" ? clamp01(classificationAnswer.confidence) : 0;

  const yes = (key: string): boolean =>
    (answers[key] as { noul?: unknown } | undefined)?.noul !== undefined
      ? Number((answers[key] as { noul: unknown }).noul) >= 0.5
      : false;

  const reasonCodes = NECESSITY_REASON_CODES.filter((code) => yes(`reason_${code}`));
  const missingInformationCodes = MISSING_INFORMATION_CODES.filter((code) => yes(`missing_${code}`));
  const requiredPredecessorNodeIds = (node?.dependencies ?? []).filter((depId) =>
    yes(`predecessor_${depId}`),
  );
  const alternativeOperationIds = input.registryOperation.alternativeOperationIds.filter((altId) =>
    yes(`alternative_${altId}`),
  );

  return {
    classification,
    confidence,
    reasonCodes,
    requiredPredecessorNodeIds,
    missingInformationCodes,
    alternativeOperationIds,
  };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
