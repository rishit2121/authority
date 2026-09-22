import { z } from "zod";

import { idSchema, timestampSchema } from "./common";

export const integrationProviderSchema = z.enum([
  "github",
  "stripe",
  "gmail",
  "postgres",
  "slack",
  "salesforce",
]);

export const integrationStatusSchema = z.enum(["connected", "warning", "not_connected"]);

/**
 * Metadata about a connected tool provider — never a credential. This
 * schema structurally cannot carry a token, password or key: it has no
 * field for one, and none should ever be added. Real connection health,
 * scope enforcement and credential isolation are later phases.
 */
export const integrationSchema = z
  .object({
    id: idSchema,
    tenantId: idSchema,
    provider: integrationProviderSchema,
    displayName: z.string().min(1),
    status: integrationStatusSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;
export type Integration = z.infer<typeof integrationSchema>;
