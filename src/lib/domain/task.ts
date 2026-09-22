import { z } from "zod";

import { idSchema, timestampSchema } from "./common";

export const taskStatusSchema = z.enum([
  "pending",
  "contract_issued",
  "executing",
  "awaiting_approval",
  "completed",
  "failed",
  "terminated",
]);

/**
 * A unit of delegated work.
 *
 * `intent` is *trusted* input — it comes from the human principal, not from
 * the agent — and is the yardstick every later request is measured against.
 */
export const taskSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    agentId: idSchema,
    principalId: idSchema,
    intent: z.string().min(1),
    status: taskStatusSchema,
    createdAt: timestampSchema,
    completedAt: timestampSchema.optional(),
  })
  .strict();

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type Task = z.infer<typeof taskSchema>;
