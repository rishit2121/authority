import type { TaskAuthorityContract } from "@/lib/domain";

/**
 * Presentation metadata for a task authority contract's lifecycle status.
 *
 * Kept next to `decision-status.ts` so a task's contract and its runtime
 * decisions describe themselves the same way everywhere they appear.
 */
export type ContractTone = "positive" | "attention" | "negative" | "neutral";

export interface ContractStatusPresentation {
  status: TaskAuthorityContract["status"];
  /** Short human label, plain language, never implying authority that isn't active. */
  label: string;
  tone: ContractTone;
}

const PRESENTATIONS: Record<TaskAuthorityContract["status"], ContractStatusPresentation> = {
  draft: { status: "draft", label: "Draft", tone: "neutral" },
  proposed: { status: "proposed", label: "Proposed", tone: "neutral" },
  awaiting_approval: { status: "awaiting_approval", label: "Awaiting approval", tone: "attention" },
  rejected: { status: "rejected", label: "Rejected", tone: "negative" },
  active: { status: "active", label: "Active", tone: "positive" },
  expired: { status: "expired", label: "Expired", tone: "neutral" },
  revoked: { status: "revoked", label: "Revoked", tone: "negative" },
  superseded: { status: "superseded", label: "Superseded", tone: "neutral" },
};

export function presentContractStatus(status: TaskAuthorityContract["status"]): ContractStatusPresentation {
  return PRESENTATIONS[status];
}

/** For a task with no contract proposed yet at all — not one of the enum's own statuses. */
export const NO_CONTRACT_LABEL = "No contract";
