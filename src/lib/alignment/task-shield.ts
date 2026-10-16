import {
  CONTENT_CHECKER_SYSTEM,
  TASK_EXTRACTION_SYSTEM,
  TOOL_CALL_CHECKER_SYSTEM,
  contentCheckerUser,
  contentMisalignmentFeedback,
  taskExtractionUser,
  toolCallCheckerUser,
  toolCallMisalignmentFeedback,
  userIntentionsReminder,
} from "./prompts";
import {
  addUsage,
  EMPTY_USAGE,
  type AlignmentReviewer,
  type ReviewerFailure,
  type ReviewerUsage,
} from "./reviewer";
import { instructionsJsonSchema, instructionsSchema, scoresJsonSchema, scoresSchema } from "./schemas";
import type { InstructionScore } from "./types";

/**
 * Task Shield's core processing algorithm (Jia et al., ACL 2025, Algorithm 1),
 * as published. This module is the REFERENCE configuration: it is used as-is
 * for paper-faithful evaluation and is the scoring core the production policy
 * builds on. It never consults Authority's contract or registry.
 *
 *   E_m <- extractTaskInstructions(m)
 *   if P(m) = user level:  T_u <- T_u ∪ E_m
 *   else for each e in E_m:
 *     c_ej <- ContributesTo score of e for each t_j in T_u, in [0, 1]
 *     C_e  <- sum_j c_ej
 *     if C_e <= epsilon: e is misaligned
 *   f <- generateFeedback(misalignments)
 *
 * The paper states the decision as "misaligned iff S(e) = 0"; Algorithm 1
 * writes C_e <= epsilon. The reference configuration uses epsilon = 0, which is
 * the same rule for scores in [0, 1].
 */

export const REFERENCE_EPSILON = 0;

export type Step<T> =
  { ok: true; value: T; usage: ReviewerUsage } | { ok: false; reason: ReviewerFailure; usage: ReviewerUsage };

export async function extractTaskInstructions(
  reviewer: AlignmentReviewer,
  subject: string,
  messageContent: string,
): Promise<Step<string[]>> {
  const result = await reviewer.call({
    name: "task_instructions",
    system: TASK_EXTRACTION_SYSTEM,
    user: taskExtractionUser(subject, messageContent),
    jsonSchema: instructionsJsonSchema,
    parse: instructionsSchema,
  });
  if (!result.ok) return result;
  const instructions = result.data.instructions.map((s) => s.trim()).filter((s) => s.length > 0);
  return { ok: true, value: instructions, usage: result.usage };
}

/**
 * The model must return exactly one score per user task instruction, in order.
 * Anything else is malformed -- a missing score is never read as zero or as one.
 */
function toInstructionScore(
  instruction: string,
  level: InstructionScore["level"],
  taskInstructions: readonly string[],
  scores: { user_task_instruction: string; contribute_to_score: number; reason: string }[],
  epsilon: number,
): InstructionScore | null {
  if (scores.length !== taskInstructions.length) return null;
  const mapped = scores.map((s, i) => ({
    userTaskInstruction: taskInstructions[i],
    score: s.contribute_to_score,
    reason: s.reason,
  }));
  const total = mapped.reduce((sum, s) => sum + s.score, 0);
  return { instruction, level, scores: mapped, total, misaligned: total <= epsilon };
}

export function taskInstructionsText(taskInstructions: readonly string[]): string {
  return taskInstructions.map((t, i) => `${i + 1}. ${t}`).join("\n");
}

/** Figure 5: an instruction from assistant text or from a tool output, scored against every t in T_u. */
export async function scoreInstruction(
  reviewer: AlignmentReviewer,
  input: {
    instruction: string;
    level: InstructionScore["level"];
    /** For tool-level instructions: `from tool [name] with arguments [args]` (Section 4.2). */
    toolInformation: string;
    taskInstructions: readonly string[];
    epsilon?: number;
  },
): Promise<Step<InstructionScore>> {
  const result = await reviewer.call({
    name: "contribution_scores",
    system: CONTENT_CHECKER_SYSTEM,
    user: contentCheckerUser({
      actionableInstruction: input.instruction,
      currentLevel: input.level,
      toolInformation: input.toolInformation,
      taskInstructionsText: taskInstructionsText(input.taskInstructions),
    }),
    jsonSchema: scoresJsonSchema,
    parse: scoresSchema,
  });
  if (!result.ok) return result;
  const scored = toInstructionScore(
    input.instruction,
    input.level,
    input.taskInstructions,
    result.data.scores,
    input.epsilon ?? REFERENCE_EPSILON,
  );
  return scored
    ? { ok: true, value: scored, usage: result.usage }
    : { ok: false, reason: "malformed", usage: result.usage };
}

/** Figure 6: a tool call (assistant level), scored against every t in T_u; inconsistent arguments score 0. */
export async function scoreToolCall(
  reviewer: AlignmentReviewer,
  input: {
    toolName: string;
    toolArgs: string;
    relatedContent: string;
    taskInstructions: readonly string[];
    epsilon?: number;
  },
): Promise<Step<InstructionScore>> {
  const result = await reviewer.call({
    name: "tool_call_scores",
    system: TOOL_CALL_CHECKER_SYSTEM,
    user: toolCallCheckerUser({
      toolName: input.toolName,
      toolArgs: input.toolArgs,
      relatedContent: input.relatedContent,
      taskInstructionsText: taskInstructionsText(input.taskInstructions),
    }),
    jsonSchema: scoresJsonSchema,
    parse: scoresSchema,
  });
  if (!result.ok) return result;
  const scored = toInstructionScore(
    `${input.toolName}(${input.toolArgs})`,
    "assistant",
    input.taskInstructions,
    result.data.scores,
    input.epsilon ?? REFERENCE_EPSILON,
  );
  return scored
    ? { ok: true, value: scored, usage: result.usage }
    : { ok: false, reason: "malformed", usage: result.usage };
}

/** Figure 7: content misalignment + tool-output violation + reminder of the user's task set. */
export function generateFeedback(input: {
  misalignedInstructions: readonly string[];
  misalignedToolCallId?: string;
  userInstructions: readonly string[];
}): string | null {
  const parts: string[] = [];
  for (const instruction of input.misalignedInstructions)
    parts.push(contentMisalignmentFeedback(instruction));
  if (input.misalignedToolCallId) parts.push(toolCallMisalignmentFeedback(input.misalignedToolCallId));
  if (parts.length === 0) return null;
  parts.push(userIntentionsReminder(input.userInstructions));
  return parts.join("\n\n");
}

export type ProcessedMessage =
  | { kind: "user"; taskInstructions: string[]; usage: ReviewerUsage }
  | {
      kind: "checked";
      instructions: InstructionScore[];
      misaligned: InstructionScore[];
      feedback: string | null;
      usage: ReviewerUsage;
    }
  | { kind: "unreviewed"; reason: ReviewerFailure; usage: ReviewerUsage };

/**
 * Algorithm 1 for one message. Every extracted instruction is scored; one
 * failed or malformed score leaves the whole message unreviewed rather than
 * partly checked.
 */
export async function processMessage(
  reviewer: AlignmentReviewer,
  input: {
    level: "user" | "assistant" | "tool";
    subject: string;
    content: string;
    taskInstructions: readonly string[];
    toolInformation?: string;
    /** Tool output ids for the Figure 7 violation line. */
    toolCallId?: string;
    epsilon?: number;
    /** Cost bound: more extracted instructions than this leaves the message unreviewed. */
    maxInstructions?: number;
  },
): Promise<ProcessedMessage> {
  const extracted = await extractTaskInstructions(reviewer, input.subject, input.content);
  if (!extracted.ok) return { kind: "unreviewed", reason: extracted.reason, usage: extracted.usage };
  let usage = extracted.usage;

  if (input.level === "user") {
    return { kind: "user", taskInstructions: [...input.taskInstructions, ...extracted.value], usage };
  }
  if (extracted.value.length > (input.maxInstructions ?? 12)) {
    return { kind: "unreviewed", reason: "budget_exhausted", usage };
  }
  if (input.taskInstructions.length === 0 && extracted.value.length > 0) {
    return { kind: "unreviewed", reason: "malformed", usage };
  }

  const instructions: InstructionScore[] = [];
  for (const instruction of extracted.value) {
    const scored = await scoreInstruction(reviewer, {
      instruction,
      level: input.level,
      toolInformation: input.toolInformation ?? "",
      taskInstructions: input.taskInstructions,
      epsilon: input.epsilon,
    });
    usage = addUsage(usage, scored.usage);
    if (!scored.ok) return { kind: "unreviewed", reason: scored.reason, usage };
    instructions.push(scored.value);
  }
  const misaligned = instructions.filter((i) => i.misaligned);
  const feedback = generateFeedback({
    misalignedInstructions: misaligned.map((m) => m.instruction),
    misalignedToolCallId: misaligned.length > 0 ? input.toolCallId : undefined,
    userInstructions: input.taskInstructions,
  });
  return { kind: "checked", instructions, misaligned, feedback, usage };
}

export { EMPTY_USAGE };
