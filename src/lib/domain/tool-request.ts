import { z } from "zod";

import { idSchema, timestampSchema, toolArgumentsSchema, toolNameSchema } from "./common";

/**
 * A single runtime request from the customer's agent to invoke one tool.
 * This is the unit the authorization evaluator decides on.
 */
export const toolRequestSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    taskId: idSchema,
    agentId: idSchema,
    tool: toolNameSchema,
    arguments: toolArgumentsSchema,
    /** Plan node this request corresponds to, when it came from a plan. */
    planNodeId: idSchema.optional(),
    requestedAt: timestampSchema,
  })
  .strict();

export type ToolRequest = z.infer<typeof toolRequestSchema>;
