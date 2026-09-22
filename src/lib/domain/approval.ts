import { z } from "zod";

import { idSchema, timestampSchema } from "./common";

export const approvalStatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);

/**
 * A human sign-off gate, raised only when a decision returns
 * `require_approval`. Routing the few genuinely out-of-boundary requests is
 * what keeps approval meaningful instead of reflexive.
 */
export const approvalSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    taskId: idSchema,
    decisionId: idSchema,
    /** Principal the request was routed to. */
    requestedFromPrincipalId: idSchema,
    status: approvalStatusSchema,
    summary: z.string().min(1),
    requestedAt: timestampSchema,
    respondedAt: timestampSchema.optional(),
    respondedByPrincipalId: idSchema.optional(),
    responseNote: z.string().optional(),
  })
  .strict();

export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
export type Approval = z.infer<typeof approvalSchema>;
