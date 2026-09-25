import { z } from "zod";

import { idSchema, tenantRoleSchema, timestampSchema } from "./common";

export const policyStatusSchema = z.enum(["draft", "active", "archived"]);
/**
 * `require_approval` (Part 3B): distinct from `deny`. A `deny` match removes
 * an operation from the plan entirely (see plan-validator.ts's
 * `evaluateActivePolicies`, unchanged). A `require_approval` match never
 * touches plan validation at all — it is read only by
 * `approval-rules.ts`'s deriver, which turns a match into a mandatory
 * activation-time approval requirement. An `allow` match still grants
 * nothing of its own, exactly as before.
 */
export const policyEffectSchema = z.enum(["allow", "deny", "require_approval"]);

/** One condition a policy's effect applies under. Glob-matched, like a contract's constraints. */
export const policyConditionSchema = z
  .object({
    key: z.string().min(1),
    matches: z.string().min(1),
  })
  .strict();

/**
 * Deterministic organization policy, evaluated alongside the Task Authority
 * Contract — not a replacement for it. A policy is immutable once
 * `status: "active"`; changing an activated policy creates a new version
 * rather than editing the row in place.
 */
export const policySchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    name: z.string().min(1),
    description: z.string().optional(),
    version: z.number().int().positive(),
    status: policyStatusSchema,
    effect: policyEffectSchema,
    conditions: z.array(policyConditionSchema).default([]),
    /** Only meaningful when `effect === "require_approval"`. Minimum role rank that may satisfy it. */
    requiredApprovalRole: tenantRoleSchema.optional(),
    /** Only meaningful when `effect === "require_approval"`. Defaults to 1 distinct qualifying approval. */
    requiredApprovalCount: z.number().int().positive().max(10).optional(),
    createdAt: timestampSchema,
    /** Set once the policy transitions from draft to active; never cleared. */
    activatedAt: timestampSchema.optional(),
  })
  .strict();

export type PolicyStatus = z.infer<typeof policyStatusSchema>;
export type PolicyEffect = z.infer<typeof policyEffectSchema>;
export type PolicyCondition = z.infer<typeof policyConditionSchema>;
export type Policy = z.infer<typeof policySchema>;
