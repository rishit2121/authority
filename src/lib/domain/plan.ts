import { z } from "zod";

import { idSchema, timestampSchema, toolArgumentsSchema, toolNameSchema } from "./common";

export const planNodeStatusSchema = z.enum(["proposed", "allowed", "rejected", "executed", "skipped"]);

/** One step of an agent-proposed plan. Untrusted until evaluated. */
export const planNodeSchema = z
  .object({
    id: idSchema,
    sequence: z.number().int().nonnegative(),
    tool: toolNameSchema,
    arguments: toolArgumentsSchema,
    status: planNodeStatusSchema,
    /** Why the node landed in its status; shown in the task investigation UI. */
    rationale: z.string().optional(),
  })
  .strict();

/**
 * The agent's proposed execution plan. Authority treats this as an untrusted
 * assertion of intent, never as an instruction.
 */
export const planSchema = z
  .object({
    id: idSchema,
    taskId: idSchema,
    nodes: z.array(planNodeSchema).min(1),
    proposedAt: timestampSchema,
  })
  .strict();

export type PlanNodeStatus = z.infer<typeof planNodeStatusSchema>;
export type PlanNode = z.infer<typeof planNodeSchema>;
export type Plan = z.infer<typeof planSchema>;
