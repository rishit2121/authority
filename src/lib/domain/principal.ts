import { z } from "zod";

import { idSchema, timestampSchema } from "./common";

/**
 * Whoever authority is ultimately traced back to. Every task must name a
 * human principal — an agent never acts on its own authority.
 */
export const principalKindSchema = z.enum(["human", "service"]);

export const principalSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    kind: principalKindSchema,
    displayName: z.string().min(1),
    email: z.email().optional(),
    createdAt: timestampSchema,
  })
  .strict();

export type PrincipalKind = z.infer<typeof principalKindSchema>;
export type Principal = z.infer<typeof principalSchema>;
