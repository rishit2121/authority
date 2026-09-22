import { principalSchema, type Principal } from "@/lib/domain";

import { throwInvalidRow } from "../errors";
import type { InsertRow, Tables } from "../db-types";

/**
 * Database row → domain `Principal`.
 *
 * `user_id` (an optional link to an authenticated application user) and
 * `demo_key` are database-only and dropped here — the domain Principal has
 * no field for either.
 */
export function principalRowToDomain(row: Tables<"principals">): Principal {
  const result = principalSchema.safeParse({
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind,
    displayName: row.display_name,
    email: row.email ?? undefined,
    createdAt: row.created_at,
  });

  if (!result.success) throwInvalidRow("principal", row.id, result.error);
  return result.data;
}

/** Fields required to create a principal. `id` and `createdAt` are assigned by the database. */
export type CreatePrincipalInput = Omit<Principal, "id" | "createdAt">;

export function principalInputToInsertRow(input: CreatePrincipalInput): InsertRow<"principals"> {
  return {
    tenant_id: input.tenantId,
    kind: input.kind,
    display_name: input.displayName,
    email: input.email ?? null,
  };
}
