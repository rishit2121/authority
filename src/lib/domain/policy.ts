import { z } from "zod";

import { idSchema, timestampSchema } from "./common";

export const policyStatusSchema = z.enum(["draft", "active", "archived"]);
export const policyEffectSchema = z.enum(["allow", "deny"]);

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
    createdAt: timestampSchema,
    /** Set once the policy transitions from draft to active; never cleared. */
    activatedAt: timestampSchema.optional(),
  })
  .strict();

export type PolicyStatus = z.infer<typeof policyStatusSchema>;
export type PolicyEffect = z.infer<typeof policyEffectSchema>;
export type PolicyCondition = z.infer<typeof policyConditionSchema>;
export type Policy = z.infer<typeof policySchema>;
