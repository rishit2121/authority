import { z } from "zod";

import { idSchema, timestampSchema } from "./common";

/** A customer organization. Every other entity is scoped to one. */
export const tenantSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/),
    createdAt: timestampSchema,
  })
  .strict();

export type Tenant = z.infer<typeof tenantSchema>;
