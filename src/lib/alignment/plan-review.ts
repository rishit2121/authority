import { randomBytes } from "node:crypto";

import { removeSecretMaterial } from "@/lib/semantic/redaction";

import { PLAN_REVIEW_SYSTEM, untrustedBlock } from "./prompts";
import {
  addUsage,
  EMPTY_USAGE,
  type AlignmentReviewer,
  type ReviewerFailure,
  type ReviewerUsage,
} from "./reviewer";
import { planReviewJsonSchema, planReviewSchema } from "./schemas";
import { generateFeedback, REFERENCE_EPSILON, scoreToolCall } from "./task-shield";
import type {
  AlignmentFinding,
  AlignmentPolicy,
  InstructionScore,
  ReviewResult,
  TaskObjectives,
} from "./types";
import { clip } from "./types";
import { checkCallValues, extractRequestLiterals } from "./values";

/**
 * Plan review during prepare: does each proposed step, with its concrete
 * values, serve the user's request?
 *
 * Reference policy: every plan step is a tool call checked with Task Shield's
 * tool-call checker (Figure 6); a step with S(e) = 0 is misaligned.
 * Production policy adds deterministic value checks against the request text
 * and a structured review of recipients, resources, amounts, side effects,
 * prohibitions and missing outcomes. An explicit conflict always wins: a
 * positive contribution score cannot clear it.
 *
 * Nothing here edits the plan. Findings go back to the caller, who must
 * submit a revised plan or get a person to review the exception.
 */

export interface PlanStep {
  id: string;
  sequence: number;
  tool: string;
  args: Record<string, unknown>;
  sideEffect: string;
  dependencies: string[];
  /** Argument keys bound to an earlier step's output. */
  derivedKeys: string[];
  /** Registry: argument keys that identify the resource. */
  resourceKeys: string[];
}

export interface PlanReview extends ReviewResult {
  usage: ReviewerUsage;
  failure?: ReviewerFailure;
}

function argsText(args: Record<string, unknown>): string {
  return removeSecretMaterial(JSON.stringify(args)).text;
}

function stepLabel(step: PlanStep): string {
  return `${step.tool}(${clip(argsText(step.args), 300)})`;
}

export async function reviewPlan(input: {
  reviewer: AlignmentReviewer | null;
  policy: AlignmentPolicy;
  objectives: TaskObjectives;
  steps: PlanStep[];
  epsilon?: number;
}): Promise<PlanReview> {
  return input.policy === "reference" ? referenceReview(input) : productionReview(input);
}

async function referenceReview(input: {
  reviewer: AlignmentReviewer | null;
  objectives: TaskObjectives;
  steps: PlanStep[];
  epsilon?: number;
}): Promise<PlanReview> {
  if (!input.reviewer) return unreviewed([], [], EMPTY_USAGE, "unavailable");
  let usage = { ...EMPTY_USAGE };
  const scores: InstructionScore[] = [];
  for (const step of input.steps) {
    const related = `Proposed plan step ${step.sequence} (expected side effect: ${step.sideEffect}${
      step.dependencies.length ? `; depends on ${step.dependencies.join(", ")}` : ""
    }).`;
    const r = await scoreToolCall(input.reviewer, {
      toolName: step.tool,
      toolArgs: argsText(step.args),
      relatedContent: related,
      taskInstructions: input.objectives.taskInstructions,
      epsilon: input.epsilon ?? REFERENCE_EPSILON,
    });
    usage = addUsage(usage, r.usage);
    if (!r.ok) return unreviewed([], scores, usage, r.reason);
    scores.push(r.value);
  }
  const misaligned = scores.filter((s) => s.misaligned);
  const findings: AlignmentFinding[] = misaligned.map((s, i) => ({
    type: "misaligned_instruction",
    source: "task_shield",
    severity: "conflict",
    stepId: input.steps[scores.indexOf(s)]?.id ?? String(i),
    value: clip(s.instruction, 300),
    explanation: `Contribution to the user's tasks is ${s.total.toFixed(2)} (misaligned at ≤ ${input.epsilon ?? REFERENCE_EPSILON}).`,
  }));
  return {
    outcome: misaligned.length > 0 ? "misaligned" : "aligned",
    findings,
    scores,
    feedback: generateFeedback({
      misalignedInstructions: misaligned.map((m) => m.instruction),
      userInstructions: input.objectives.taskInstructions,
    }),
    usage,
  };
}

async function productionReview(input: {
  reviewer: AlignmentReviewer | null;
  objectives: TaskObjectives;
  steps: PlanStep[];
  epsilon?: number;
}): Promise<PlanReview> {
  const epsilon = input.epsilon ?? REFERENCE_EPSILON;
  const literals = extractRequestLiterals(input.objectives.requestText);
  const deterministic = input.steps.flatMap((step) =>
    checkCallValues(
      {
        stepId: step.id,
        tool: step.tool,
        args: step.args,
        derivedKeys: new Set(step.derivedKeys),
        resourceKeys: new Set(step.resourceKeys),
      },
      literals,
    ),
  );

  if (!input.reviewer)
    return combine(deterministic, [], [], EMPTY_USAGE, input.objectives, input.steps, "unavailable");

  const nonce = randomBytes(8).toString("hex");
  const planText = input.steps
    .map(
      (s) =>
        `step_id=${s.id} sequence=${s.sequence} tool=${s.tool} side_effect=${s.sideEffect}${
          s.dependencies.length ? ` depends_on=${s.dependencies.join(",")}` : ""
        }${s.derivedKeys.length ? ` values_from_earlier_steps=${s.derivedKeys.join(",")}` : ""} arguments=${argsText(s.args)}`,
    )
    .join("\n");
  const user = [
    `The user's request (trusted):\n"""\n${input.objectives.requestText}\n"""`,
    `User task instructions:\n${input.objectives.taskInstructions.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    input.objectives.prohibitions.length
      ? `The user forbids:\n${input.objectives.prohibitions.map((p) => `- ${p}`).join("\n")}`
      : "",
    input.objectives.requirements.length
      ? `Values the user fixed:\n${input.objectives.requirements.map((r) => `- ${r.kind}: ${r.value}`).join("\n")}`
      : "",
    `Proposed plan (untrusted; score every step against every user task instruction, in order):\n${untrustedBlock("plan", nonce, planText)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const r = await input.reviewer.call({
    name: "plan_review",
    system: PLAN_REVIEW_SYSTEM,
    user,
    jsonSchema: planReviewJsonSchema,
    parse: planReviewSchema,
  });
  if (!r.ok) return combine(deterministic, [], [], r.usage, input.objectives, input.steps, r.reason);

  const byStep = new Map(r.data.steps.map((s) => [s.step_id, s.scores]));
  const scores: InstructionScore[] = [];
  for (const step of input.steps) {
    const stepScores = byStep.get(step.id);
    // Every step needs one score per user task instruction; otherwise the review is incomplete.
    if (!stepScores || stepScores.length !== input.objectives.taskInstructions.length) {
      return combine(deterministic, [], scores, r.usage, input.objectives, input.steps, "malformed");
    }
    const mapped = stepScores.map((s, i) => ({
      userTaskInstruction: input.objectives.taskInstructions[i],
      score: s.contribute_to_score,
    }));
    const total = mapped.reduce((sum, s) => sum + s.score, 0);
    scores.push({
      instruction: stepLabel(step),
      level: "assistant",
      scores: mapped,
      total,
      misaligned: total <= epsilon,
    });
  }

  const semantic: AlignmentFinding[] = r.data.findings.map((f) => ({
    type: f.type,
    source: "semantic",
    severity: f.severity,
    ...(f.step_id ? { stepId: f.step_id } : {}),
    ...(f.field ? { field: f.field } : {}),
    explanation: f.explanation,
  }));
  const zeroContribution: AlignmentFinding[] = scores
    .map((s, i) => ({ s, step: input.steps[i] }))
    .filter(({ s }) => s.misaligned)
    .map(({ s, step }) => ({
      type: "misaligned_instruction" as const,
      source: "task_shield" as const,
      severity: "conflict" as const,
      stepId: step.id,
      value: clip(s.instruction, 300),
      explanation: `This step contributes nothing to the user's request (score ${s.total.toFixed(2)}).`,
    }));
  return combine(
    deterministic,
    [...semantic, ...zeroContribution],
    scores,
    r.usage,
    input.objectives,
    input.steps,
  );
}

/** The production decision rule. Conflicts first; positive scores never clear a conflict. */
function combine(
  deterministic: AlignmentFinding[],
  reviewed: AlignmentFinding[],
  scores: InstructionScore[],
  usage: ReviewerUsage,
  objectives: TaskObjectives,
  steps: PlanStep[],
  failure?: ReviewerFailure,
): PlanReview {
  const findings = [...deterministic, ...reviewed];
  if (failure) {
    findings.push({
      type: "reviewer_unavailable",
      source: "semantic",
      severity: "unreviewed",
      explanation: `Semantic review did not complete (${failure}); only deterministic checks ran.`,
    });
  }
  const hasConflict = findings.some((f) => f.severity === "conflict");
  const hasAmbiguity = findings.some((f) => f.severity === "ambiguous");
  const outcome = hasConflict
    ? "misaligned"
    : failure
      ? "unreviewed"
      : hasAmbiguity
        ? "ambiguous"
        : "aligned";
  return {
    outcome,
    findings,
    scores,
    feedback: planFeedback(findings, objectives, steps),
    usage,
    ...(failure ? { failure } : {}),
  };
}

function unreviewed(
  findings: AlignmentFinding[],
  scores: InstructionScore[],
  usage: ReviewerUsage,
  failure: ReviewerFailure,
): PlanReview {
  return {
    outcome: "unreviewed",
    findings: [
      ...findings,
      {
        type: "reviewer_unavailable",
        source: "task_shield",
        severity: "unreviewed",
        explanation: `Review did not complete (${failure}).`,
      },
    ],
    scores,
    feedback: null,
    usage,
    failure,
  };
}

export function planFeedback(
  findings: AlignmentFinding[],
  objectives: TaskObjectives,
  steps: PlanStep[],
): string | null {
  const actionable = findings.filter((f) => f.severity === "conflict" || f.severity === "ambiguous");
  if (actionable.length === 0) return null;
  const label = (id?: string) => {
    const step = steps.find((s) => s.id === id);
    return step ? `Step ${step.sequence} (${step.tool})` : "The plan";
  };
  const lines = actionable.map(
    (f) =>
      `- ${label(f.stepId)}${f.field ? `, ${f.field}` : ""}: ${f.explanation} [${f.type}, ${f.severity}]`,
  );
  return [
    "The plan does not match the user's request:",
    ...lines,
    "Next: submit a revised plan, or ask an administrator to review this exception.",
    `User's request: ${clip(objectives.requestText, 500)}`,
  ].join("\n");
}
