import type { FindingType } from "./schemas";

export type AlignmentMode = "off" | "shadow" | "enforce";
export type AlignmentPolicy = "reference" | "production";
export type ReviewOutcome = "aligned" | "misaligned" | "ambiguous" | "unreviewed";
export type ContentStatus = "passed" | "flagged" | "quarantined" | "held" | "unreviewed";

export interface Requirement {
  kind: string;
  value: string;
  text: string;
}

/** The trusted task set for one task version. `requestText` is always kept: extraction can miss things. */
export interface TaskObjectives {
  version: number;
  requestText: string;
  /** T_u: the user's actionable instructions (Task Shield's user task set). */
  taskInstructions: string[];
  prohibitions: string[];
  requirements: Requirement[];
  quotedMaterial: string[];
}

export type FindingSource = "deterministic" | "semantic" | "task_shield" | "inspection";

export interface AlignmentFinding {
  type:
    | FindingType
    | "misaligned_instruction"
    | "injected_directive"
    | "uncertain_directive"
    | "data_instruction"
    | "reviewer_unavailable"
    | "oversized"
    | "unsupported_content";
  source: FindingSource;
  severity: "conflict" | "ambiguous" | "unreviewed" | "info";
  stepId?: string;
  field?: string;
  /** The offending value or instruction, bounded; never a whole document. */
  value?: string;
  explanation: string;
}

/** One extracted instruction e with its per-objective scores s(e, t) and S(e) = sum_t s(e, t). */
export interface InstructionScore {
  instruction: string;
  level: "assistant" | "tool";
  scores: { userTaskInstruction: string; score: number; reason?: string }[];
  total: number;
  misaligned: boolean;
}

export interface ReviewResult {
  outcome: ReviewOutcome;
  findings: AlignmentFinding[];
  scores: InstructionScore[];
  /** Task Shield style feedback for the agent: what is misaligned, and the user's task set. */
  feedback: string | null;
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
