import { integrationSchema, type Integration } from "@/lib/domain";

import { throwInvalidRow } from "../errors";
import type { InsertRow, Tables, UpdateRow } from "../db-types";

/**
 * Database row → domain `Integration`.
 *
 * `configured_scopes_metadata`, `health_metadata`, `created_by` and
 * `demo_key` are database-only. No credential of any kind exists in this
 * table or this mapper — see the column comment in
 * `20260923000006_policies_integrations.sql`.
 */
export function integrationRowToDomain(row: Tables<"integrations">): Integration {
  const result = integrationSchema.safeParse({
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    displayName: row.display_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  if (!result.success) throwInvalidRow("integration", row.id, result.error);
  return result.data;
}

export interface CreateIntegrationInput {
  tenantId: string;
  provider: Integration["provider"];
  displayName: string;
  status?: Integration["status"];
  createdBy?: string;
}

export function integrationInputToInsertRow(input: CreateIntegrationInput): InsertRow<"integrations"> {
  return {
    tenant_id: input.tenantId,
    provider: input.provider,
    display_name: input.displayName,
    status: input.status,
    created_by: input.createdBy ?? null,
  };
}

export interface UpdateIntegrationInput {
  displayName?: string;
  status?: Integration["status"];
}

export function updateIntegrationToUpdateRow(input: UpdateIntegrationInput): UpdateRow<"integrations"> {
  return {
    display_name: input.displayName,
    status: input.status,
  };
}
