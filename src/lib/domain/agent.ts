import { z } from "zod";

import { idSchema, timestampSchema } from "./common";

export const agentStatusSchema = z.enum(["active", "paused", "revoked"]);

/**
 * A customer-owned agent. Authority never runs the agent or its planner; it
 * only records identity so decisions and capabilities can be attributed.
 */
export const agentSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    name: z.string().min(1),
    model: z.string().min(1),
    framework: z.string().min(1),
    /** Human principal accountable for what this agent does. */
    ownerPrincipalId: idSchema,
    status: agentStatusSchema,
    createdAt: timestampSchema,
  })
  .strict();

export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type Agent = z.infer<typeof agentSchema>;
