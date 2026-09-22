import { z } from "zod";

import { idSchema, timestampSchema, toolArgumentsSchema, toolNameSchema } from "./common";

/**
 * Provider-neutral semantic evaluation contract.
 *
 * A semantic provider (Jev in production, Laya or another later) supplies
 * *evidence* about whether a request is semantically consistent with the task.
 * It is advisory input to the deterministic evaluator and nothing more.
 *
 * A provider must never: hold credentials, mint capabilities, override a hard
 * deny, widen the Task Authority Contract, or independently approve a
 * high-risk operation. Nothing in this module references a specific vendor,
 * so implementations stay swappable.
 */

/** A probability in [0, 1]. */
export const probabilitySchema = z.number().min(0).max(1);

export const semanticDecisionInputSchema = z
  .object({
    taskId: idSchema,
    /** Trusted user intent — the yardstick for alignment. */
    taskIntent: z.string().min(1),
    tool: toolNameSchema,
    arguments: toolArgumentsSchema,
    /** Contract actions in play, so the provider can reason about scope. */
    contractAllowedTools: z.array(toolNameSchema),
    /** Preceding plan steps, for consistency checks. */
    priorPlanTools: z.array(toolNameSchema).default([]),
  })
  .strict();

/**
 * Structured evidence returned by a semantic provider. Every probability is
 * an independent signal; the evaluator decides what to do with them.
 */
export const semanticDecisionResultSchema = z
  .object({
    /** Provider identity, e.g. "mock" or "jev". */
    provider: z.string().min(1),
    model: z.string().min(1),
    modelVersion: z.string().min(1),

    /** Does the action serve the user's stated task? */
    taskRelevanceProbability: probabilitySchema,
    /** Are the targeted resources the ones the task concerns? */
    resourceRelevanceProbability: probabilitySchema,
    /** Does this reach beyond the contract's intended scope? */
    scopeExpansionProbability: probabilitySchema,
    /** Would this disclose data outside the organization? */
    externalDisclosureProbability: probabilitySchema,
    /** Is the request consistent with the plan proposed so far? */
    planConsistencyProbability: probabilitySchema,
    /** Aggregate semantic risk. */
    semanticRiskProbability: probabilitySchema,

    /** Provider's confidence in its own output. */
    overallConfidence: probabilitySchema,
    latencyMs: z.number().nonnegative(),
    /** Set when the provider timed out or failed; signals are then unusable. */
    state: z.enum(["ok", "timeout", "error"]),
    errorMessage: z.string().optional(),
    evaluatedAt: timestampSchema,
  })
  .strict();

export type Probability = z.infer<typeof probabilitySchema>;
export type SemanticDecisionInput = z.infer<typeof semanticDecisionInputSchema>;
export type SemanticDecisionResult = z.infer<typeof semanticDecisionResultSchema>;
