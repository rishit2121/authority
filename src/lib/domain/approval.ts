import { z } from "zod";

import { idSchema, tenantRoleSchema, timestampSchema } from "./common";

export const approvalStatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);

/**
 * A human sign-off gate. Two distinct bindings, never both at once (see the
 * database's `approvals_exactly_one_binding` check):
 *
 *  - Decision-bound (`decisionId` set): raised when a runtime authorization
 *    decision returns `require_approval` — the original, Part 2B shape.
 *  - Contract-bound (`contractId` set, Part 3B): one required *slot* toward
 *    activating a specific, exact contract version. `requiredKind`/
 *    `requiredRole` describe who may satisfy it —
 *    `lib/authorization/approval-rules.ts`'s deriver is what decided there
 *    should be one, never this type itself.
 */
export const approvalSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    taskId: idSchema,
    decisionId: idSchema.optional(),
    contractId: idSchema.optional(),
    contractVersion: z.number().int().positive().optional(),
    requiredKind: z.enum(["task_owner", "role"]).optional(),
    /** Present only when `requiredKind === "role"`. */
    requiredRole: tenantRoleSchema.optional(),
    selfApprovalAllowed: z.boolean().optional(),
    /** Principal the request was routed to — for a contract-bound "task_owner" slot, the task's own principal. */
    requestedFromPrincipalId: idSchema.optional(),
    status: approvalStatusSchema,
    summary: z.string().min(1),
    requestedAt: timestampSchema,
    respondedAt: timestampSchema.optional(),
    respondedByPrincipalId: idSchema.optional(),
    responseNote: z.string().optional(),
  })
  .strict()
  .refine((a) => Boolean(a.decisionId) !== Boolean(a.contractId), {
    message: "an approval must be bound to exactly one of decisionId or contractId",
  });

export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
export type Approval = z.infer<typeof approvalSchema>;
