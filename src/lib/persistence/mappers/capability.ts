import { capabilitySchema, type Capability } from "@/lib/domain";

import { throwInvalidRow } from "../errors";
import type { InsertRow, Tables } from "../db-types";
import { readVersionedJson } from "../versioned-json";

/**
 * Database row → domain `Capability`.
 *
 * `resource_constraints` maps to the domain's `constraints`. `agent_id`,
 * `argument_constraints` and `demo_key` are database-only — the domain
 * doesn't distinguish resource- from argument-level constraints, and has no
 * `agentId` field of its own. `authorization_decision_id` maps to the
 * domain's `decisionId`, and `consumed_uses` to `usedInvocations`.
 *
 * Read-only at the database layer in this phase: no authenticated role holds
 * INSERT/UPDATE/DELETE on `capabilities` at all (see
 * `20260923000008_product_rls.sql`) — a capability service is a later part.
 */
export function capabilityRowToDomain(row: Tables<"capabilities">): Capability {
  const resourceConstraints = readVersionedJson(
    row.resource_constraints,
    [1],
    "capabilities.resource_constraints",
  );

  const result = capabilitySchema.safeParse({
    id: row.id,
    tenantId: row.tenant_id,
    taskId: row.task_id,
    decisionId: row.authorization_decision_id,
    tool: row.tool,
    constraints: resourceConstraints.items,
    status: row.status,
    maxInvocations: row.max_invocations,
    usedInvocations: row.consumed_uses,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at ?? undefined,
    revocationReason: row.revocation_reason ?? undefined,
  });

  if (!result.success) throwInvalidRow("capability", row.id, result.error);
  return result.data;
}

export interface CreateCapabilityInput {
  tenantId: string;
  taskId: string;
  decisionId: string;
  agentId: string;
  tool: string;
  constraints?: Capability["constraints"];
  maxInvocations: number;
  expiresAt: string;
  status?: Capability["status"];
}

export function capabilityInputToInsertRow(input: CreateCapabilityInput): InsertRow<"capabilities"> {
  return {
    tenant_id: input.tenantId,
    task_id: input.taskId,
    authorization_decision_id: input.decisionId,
    agent_id: input.agentId,
    tool: input.tool,
    resource_constraints: { schemaVersion: 1, items: input.constraints ?? [] },
    max_invocations: input.maxInvocations,
    expires_at: input.expiresAt,
    status: input.status,
  };
}
