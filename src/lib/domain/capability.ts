import { z } from "zod";

import { idSchema, timestampSchema, toolNameSchema } from "./common";
import { resourceConstraintSchema } from "./task-authority-contract";

export const capabilityStatusSchema = z.enum(["active", "expired", "revoked", "consumed"]);

/**
 * A temporary, constrained permission issued after an approving decision.
 *
 * Capabilities are the only thing that unlocks a credential, they always
 * carry an expiry, and they are revoked when the task ends. A capability is
 * never standing access — hence `expiresAt` being required.
 */
export const capabilitySchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    taskId: idSchema,
    /** Decision that authorized issuing this capability. */
    decisionId: idSchema,
    tool: toolNameSchema,
    constraints: z.array(resourceConstraintSchema).default([]),
    status: capabilityStatusSchema,
    maxInvocations: z.number().int().positive(),
    usedInvocations: z.number().int().nonnegative().default(0),
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
    revokedAt: timestampSchema.optional(),
    revocationReason: z.string().optional(),
  })
  .strict()
  .refine((c) => c.usedInvocations <= c.maxInvocations, {
    message: "usedInvocations cannot exceed maxInvocations",
  });

export type CapabilityStatus = z.infer<typeof capabilityStatusSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
