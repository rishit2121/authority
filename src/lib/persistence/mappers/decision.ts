import { authorizationDecisionSchema, type AuthorizationDecision } from "@/lib/domain";

import { throwInvalidRow } from "../errors";
import type { InsertRow, Tables } from "../db-types";
import { readVersionedJson } from "../versioned-json";
import { semanticDecisionRowToDomain } from "./semantic-decision";

/**
 * Database row(s) → domain `AuthorizationDecision`.
 *
 * `outcome` maps to the domain's `status`; `created_at` maps to `decidedAt`.
 * `contract_id`, `contract_version`, `matched_policy_ids`,
 * `evidence_references` and `demo_key` are database-only, dropped — the
 * domain has no field for any of them.
 *
 * `semanticRow` is the joined `semantic_decisions` row when
 * `semantic_decision_id` is set; fetching it is the repository's job, not
 * this mapper's. Passing it through embeds it as `semanticEvidence`, exactly
 * as `AuthorizationDecision` expects — the semantic result is addressed by
 * its own id in the database but has no identity of its own in the domain.
 */
export function decisionRowToDomain(
  row: Tables<"authorization_decisions">,
  semanticRow?: Tables<"semantic_decisions"> | null,
): AuthorizationDecision {
  const reasonCodes = readVersionedJson(row.reason_codes, [1], "authorization_decisions.reason_codes");
  const appliedConstraints = readVersionedJson(
    row.applied_constraints,
    [1],
    "authorization_decisions.applied_constraints",
  );

  const result = authorizationDecisionSchema.safeParse({
    id: row.id,
    tenantId: row.tenant_id,
    taskId: row.task_id,
    toolRequestId: row.tool_request_id,
    status: row.outcome,
    reasons: reasonCodes.items,
    appliedConstraints: appliedConstraints.items,
    semanticEvidence: semanticRow ? semanticDecisionRowToDomain(semanticRow) : undefined,
    latencyMs: row.latency_ms,
    decidedAt: row.created_at,
  });

  if (!result.success) throwInvalidRow("authorization_decision", row.id, result.error);
  return result.data;
}

export interface CreateDecisionInput {
  tenantId: string;
  taskId: string;
  toolRequestId: string;
  contractId: string;
  contractVersion: number;
  status: AuthorizationDecision["status"];
  reasons: AuthorizationDecision["reasons"];
  appliedConstraints?: AuthorizationDecision["appliedConstraints"];
  semanticDecisionId?: string;
  latencyMs: number;
}

/**
 * Append-only at the database layer (no authenticated role holds UPDATE or
 * DELETE — see `20260923000008_product_rls.sql`). This mapper produces an
 * INSERT payload only; there is deliberately no update counterpart.
 */
export function decisionInputToInsertRow(input: CreateDecisionInput): InsertRow<"authorization_decisions"> {
  return {
    tenant_id: input.tenantId,
    task_id: input.taskId,
    tool_request_id: input.toolRequestId,
    contract_id: input.contractId,
    contract_version: input.contractVersion,
    semantic_decision_id: input.semanticDecisionId ?? null,
    outcome: input.status,
    reason_codes: { schemaVersion: 1, items: input.reasons },
    applied_constraints: { schemaVersion: 1, items: input.appliedConstraints ?? [] },
    latency_ms: input.latencyMs,
  };
}
