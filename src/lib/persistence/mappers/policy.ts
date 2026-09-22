import { policySchema, type Policy } from "@/lib/domain";

import { throwInvalidRow } from "../errors";
import type { InsertRow, Tables } from "../db-types";
import { readVersionedJson } from "../versioned-json";

/**
 * Database row → domain `Policy`.
 *
 * `conditions` is versioned JSONB whose `rules` become the domain's
 * `conditions` array. `created_by` and `demo_key` are database-only.
 *
 * Immutable once `status: "active"` — enforced by a trigger that blocks
 * UPDATE/DELETE regardless of role once activated (see
 * `20260923000009_lifecycle_triggers.sql`). A change to an active policy
 * means inserting a new `(tenant_id, name, version)` row, never updating
 * this one — there is deliberately no "update an active policy" mapper.
 */
export function policyRowToDomain(row: Tables<"policies">): Policy {
  const conditions = readVersionedJson(row.conditions, [1], "policies.conditions");

  const result = policySchema.safeParse({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description ?? undefined,
    version: row.version,
    status: row.status,
    effect: row.effect,
    conditions: conditions.rules,
    createdAt: row.created_at,
    activatedAt: row.activated_at ?? undefined,
  });

  if (!result.success) throwInvalidRow("policy", row.id, result.error);
  return result.data;
}

export interface CreatePolicyInput {
  tenantId: string;
  name: string;
  effect: Policy["effect"];
  description?: string;
  version?: number;
  status?: Policy["status"];
  conditions?: Policy["conditions"];
  createdBy?: string;
}

export function policyInputToInsertRow(input: CreatePolicyInput): InsertRow<"policies"> {
  return {
    tenant_id: input.tenantId,
    name: input.name,
    effect: input.effect,
    description: input.description ?? null,
    version: input.version,
    status: input.status,
    conditions: { schemaVersion: 1, rules: input.conditions ?? [] },
    created_by: input.createdBy ?? null,
  };
}
