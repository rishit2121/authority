import { z } from "zod";

import { idSchema, timestampSchema } from "./common";

export const executionEventTypeSchema = z.enum([
  "task_received",
  "contract_issued",
  "plan_proposed",
  "request_evaluated",
  "capability_issued",
  "tool_invoked",
  "tool_failed",
  "approval_requested",
  "approval_resolved",
  "capability_revoked",
  "task_completed",
  "task_terminated",
]);

export const executionOutcomeSchema = z.enum(["success", "failure", "blocked", "info"]);

/**
 * One entry in the append-only task trace. Together these form the audit
 * record: what was asked, what was decided, what actually ran.
 */
export const executionEventSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    taskId: idSchema,
    type: executionEventTypeSchema,
    outcome: executionOutcomeSchema,
    summary: z.string().min(1),
    detail: z.string().optional(),
    /** Related decision or capability, when the event stems from one. */
    decisionId: idSchema.optional(),
    capabilityId: idSchema.optional(),
    occurredAt: timestampSchema,
  })
  .strict();

export type ExecutionEventType = z.infer<typeof executionEventTypeSchema>;
export type ExecutionOutcome = z.infer<typeof executionOutcomeSchema>;
export type ExecutionEvent = z.infer<typeof executionEventSchema>;
