import { z } from "zod";

import { idSchema, timestampSchema } from "./common";
import { resourceConstraintSchema } from "./task-authority-contract";
import { semanticDecisionResultSchema } from "./semantic-decision";

/**
 * The six outcomes Authority can return for a tool request.
 *
 * - `allow`             — permitted as requested
 * - `allow_constrained` — permitted, but narrowed before execution
 * - `replan`            — not permitted; the agent should propose something else
 * - `clarify`           — user intent is too ambiguous to decide
 * - `require_approval`  — a human principal must sign off first
 * - `deny`              — refused outright
 */
export const decisionStatusSchema = z.enum([
  "allow",
  "allow_constrained",
  "replan",
  "clarify",
  "require_approval",
  "deny",
]);

/** Why a decision came out the way it did, for audit and UI. */
export const decisionReasonSchema = z
  .object({
    code: z.string().min(1),
    detail: z.string().min(1),
    /** `policy` reasons are deterministic; `semantic` are advisory evidence. */
    source: z.enum(["policy", "contract", "semantic", "limit"]),
  })
  .strict();

export const authorizationDecisionSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    taskId: idSchema,
    toolRequestId: idSchema,
    status: decisionStatusSchema,
    reasons: z.array(decisionReasonSchema).min(1),
    /** Narrowing applied when status is `allow_constrained`. */
    appliedConstraints: z.array(resourceConstraintSchema).default([]),
    /** Advisory evidence, absent when no provider was consulted. */
    semanticEvidence: semanticDecisionResultSchema.optional(),
    latencyMs: z.number().nonnegative(),
    decidedAt: timestampSchema,
  })
  .strict();

export type DecisionStatus = z.infer<typeof decisionStatusSchema>;
export type DecisionReason = z.infer<typeof decisionReasonSchema>;
export type AuthorizationDecision = z.infer<typeof authorizationDecisionSchema>;

/** Statuses under which execution may proceed. */
export const PERMITTED_STATUSES = ["allow", "allow_constrained"] as const satisfies readonly DecisionStatus[];

export function isPermitted(status: DecisionStatus): boolean {
  return (PERMITTED_STATUSES as readonly DecisionStatus[]).includes(status);
}
