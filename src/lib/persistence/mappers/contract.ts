import {
  taskAuthorityContractSchema,
  type AllowedAction,
  type EphemeralLimits,
  type TaskAuthorityContract,
} from "@/lib/domain";
import type { Database } from "@/lib/supabase/database.types";

import { throwInvalidRow } from "../errors";
import type { InsertRow, Tables } from "../db-types";
import { readVersionedJson } from "../versioned-json";

/**
 * Database row → domain `TaskAuthorityContract`.
 *
 * `allowed_actions` and `ephemeral_limits` are versioned JSONB (see
 * `supabase/JSONB_VERSIONING.md`); `readVersionedJson` rejects anything not
 * on this mapper's known-version list before the payload's contents are
 * trusted at all. `source_evidence_metadata`, `created_by` and `demo_key`
 * stay database-only. `version`, `contract_status` and `rejection_reason`
 * are passed through as of Part 3A — a contract can now genuinely sit in a
 * non-active lifecycle state for a visible stretch of time, so the domain
 * type must say which one it's in rather than assuming "active."
 */
export function contractRowToDomain(row: Tables<"task_authority_contracts">): TaskAuthorityContract {
  const allowedActionsPayload = readVersionedJson(
    row.allowed_actions,
    [1],
    "task_authority_contracts.allowed_actions",
  );
  const ephemeralLimitsPayload = readVersionedJson(
    row.ephemeral_limits,
    [1],
    "task_authority_contracts.ephemeral_limits",
  );
  const requiredApprovalsSpecPayload = row.required_approvals_spec
    ? readVersionedJson(row.required_approvals_spec, [1], "task_authority_contracts.required_approvals_spec")
    : undefined;

  const result = taskAuthorityContractSchema.safeParse({
    id: row.id,
    tenantId: row.tenant_id,
    taskId: row.task_id,
    planId: row.plan_id ?? undefined,
    version: row.version,
    specVersion: row.spec_version,
    status: row.contract_status,
    registryVersion: row.registry_version ?? undefined,
    compilerVersion: row.compiler_version ?? undefined,
    inputHash: row.input_hash ?? undefined,
    outputHash: row.output_hash ?? undefined,
    allowedActions: allowedActionsPayload.items,
    forbiddenResources: row.forbidden_resources,
    forbiddenOperations: row.forbidden_operations ?? [],
    ephemeralLimits: {
      maxToolInvocations: ephemeralLimitsPayload.maxToolInvocations,
      expiresInSeconds: ephemeralLimitsPayload.expiresInSeconds,
    },
    requiredApprovalsSpec: requiredApprovalsSpecPayload?.items ?? [],
    rejectionReason: row.rejection_reason ?? undefined,
    activatedAt: row.activated_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    revocationReason: row.revocation_reason ?? undefined,
    supersededAt: row.superseded_at ?? undefined,
    supersededByContractId: row.superseded_by_contract_id ?? undefined,
    createdAt: row.created_at,
  });

  if (!result.success) throwInvalidRow("task_authority_contract", row.id, result.error);
  return result.data;
}

export interface CreateContractInput {
  tenantId: string;
  taskId: string;
  specVersion: string;
  allowedActions: AllowedAction[];
  forbiddenResources: string[];
  ephemeralLimits: EphemeralLimits;
  version?: number;
  contractStatus?: Database["public"]["Enums"]["contract_status"];
  createdBy?: string;
}

export function contractInputToInsertRow(input: CreateContractInput): InsertRow<"task_authority_contracts"> {
  return {
    tenant_id: input.tenantId,
    task_id: input.taskId,
    version: input.version,
    spec_version: input.specVersion,
    allowed_actions: { schemaVersion: 1, items: input.allowedActions },
    forbidden_resources: input.forbiddenResources,
    ephemeral_limits: { schemaVersion: 1, ...input.ephemeralLimits },
    contract_status: input.contractStatus,
    created_by: input.createdBy ?? null,
  };
}
