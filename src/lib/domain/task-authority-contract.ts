import { z } from "zod";

import { idSchema, timestampSchema, toolNameSchema } from "./common";

/**
 * A constraint narrowing one allowed action to specific resources.
 * `equals` pins an exact value; `matches` is a glob for families like `fix-*`.
 */
export const resourceConstraintSchema = z
  .object({
    key: z.string().min(1),
    equals: z.string().optional(),
    matches: z.string().optional(),
  })
  .strict()
  .refine((c) => Boolean(c.equals) !== Boolean(c.matches), {
    message: "resource constraint needs exactly one of `equals` or `matches`",
  });

export const allowedActionSchema = z
  .object({
    tool: toolNameSchema,
    constraints: z.array(resourceConstraintSchema).default([]),
    /** Cap on how many times this specific action may run under the contract. */
    maxInvocations: z.number().int().positive().optional(),
  })
  .strict();

export const ephemeralLimitsSchema = z
  .object({
    maxToolInvocations: z.number().int().positive(),
    expiresInSeconds: z.number().int().positive(),
  })
  .strict();

/**
 * The maximum authority a task may ever receive — derived from trusted user
 * intent *before* the agent proposes anything. Nothing downstream may widen
 * it: the evaluator and the semantic provider can only ever narrow.
 */
export const taskAuthorityContractSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    taskId: idSchema,
    specVersion: z.string().min(1),
    allowedActions: z.array(allowedActionSchema).min(1),
    /** Hard denials. These outrank every allow and every semantic signal. */
    forbiddenResources: z.array(z.string().min(1)).default([]),
    ephemeralLimits: ephemeralLimitsSchema,
    createdAt: timestampSchema,
  })
  .strict();

export type ResourceConstraint = z.infer<typeof resourceConstraintSchema>;
export type AllowedAction = z.infer<typeof allowedActionSchema>;
export type EphemeralLimits = z.infer<typeof ephemeralLimitsSchema>;
export type TaskAuthorityContract = z.infer<typeof taskAuthorityContractSchema>;
