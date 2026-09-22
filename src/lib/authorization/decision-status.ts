import type { DecisionStatus } from "@/lib/domain";

/**
 * Presentation metadata for the six decision statuses.
 *
 * Kept as pure data next to the authorization logic so the dashboard, task
 * page and marketing console preview all describe a decision identically.
 * `tone` names a semantic role; components map it to their own classes.
 */
export type DecisionTone = "positive" | "constrained" | "attention" | "neutral" | "negative";

export interface DecisionStatusPresentation {
  status: DecisionStatus;
  /** Short human label, e.g. "Allow constrained". */
  label: string;
  /** Uppercase token used in dense/monospace contexts. */
  token: string;
  tone: DecisionTone;
  /** One sentence explaining what the status means. */
  description: string;
  /** Whether execution may proceed under this status. */
  permitsExecution: boolean;
}

const PRESENTATIONS: Record<DecisionStatus, DecisionStatusPresentation> = {
  allow: {
    status: "allow",
    label: "Allow",
    token: "ALLOW",
    tone: "positive",
    description: "Permitted as requested; a scoped capability was issued.",
    permitsExecution: true,
  },
  allow_constrained: {
    status: "allow_constrained",
    label: "Allow constrained",
    token: "ALLOW_CONSTRAINED",
    tone: "constrained",
    description: "Permitted, but narrowed to specific resources before execution.",
    permitsExecution: true,
  },
  replan: {
    status: "replan",
    label: "Replan",
    token: "REPLAN",
    tone: "attention",
    description: "Not permitted as proposed; the agent must propose a different action.",
    permitsExecution: false,
  },
  clarify: {
    status: "clarify",
    label: "Clarify",
    token: "CLARIFY",
    tone: "neutral",
    description: "User intent is too ambiguous to authorize; clarification is required.",
    permitsExecution: false,
  },
  require_approval: {
    status: "require_approval",
    label: "Require approval",
    token: "REQUIRE_APPROVAL",
    tone: "attention",
    description: "Exceeds the verified task boundary; a human principal must approve.",
    permitsExecution: false,
  },
  deny: {
    status: "deny",
    label: "Deny",
    token: "DENY",
    tone: "negative",
    description: "Refused outright; the request violates policy or the task contract.",
    permitsExecution: false,
  },
};

export function presentDecisionStatus(status: DecisionStatus): DecisionStatusPresentation {
  return PRESENTATIONS[status];
}

/** Every presentation, in escalation order — useful for legends and filters. */
export const DECISION_STATUS_ORDER: readonly DecisionStatus[] = [
  "allow",
  "allow_constrained",
  "clarify",
  "replan",
  "require_approval",
  "deny",
];

export function allDecisionStatusPresentations(): DecisionStatusPresentation[] {
  return DECISION_STATUS_ORDER.map(presentDecisionStatus);
}
