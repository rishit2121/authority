import { approvalSchema, type Approval } from "@/lib/domain";

import { throwInvalidRow } from "../errors";
import type { InsertRow, Tables, UpdateRow } from "../db-types";

/**
 * Database row → domain `Approval`.
 *
 * `decision_reason` maps to the domain's `responseNote`; `decided_at` maps
 * to `respondedAt`. `requested_authority_delta`, `requested_by` (the app
 * user who raised it) and `assigned_approver_principal_id` (pre-resolution
 * routing) are database-only — the domain doesn't represent an in-flight
 * "assigned to" state distinct from who ultimately responded.
 */
export function approvalRowToDomain(row: Tables<"approvals">): Approval {
  const result = approvalSchema.safeParse({
    id: row.id,
    tenantId: row.tenant_id,
    taskId: row.task_id,
    decisionId: row.authorization_decision_id ?? undefined,
    contractId: row.contract_id ?? undefined,
    contractVersion: row.contract_version ?? undefined,
    requiredKind: row.required_kind ?? undefined,
    requiredRole: row.required_role ?? undefined,
    selfApprovalAllowed: row.contract_id ? row.self_approval_allowed : undefined,
    requestedFromPrincipalId: row.requested_from_principal_id ?? undefined,
    status: row.status,
    summary: row.summary,
    requestedAt: row.requested_at,
    respondedAt: row.decided_at ?? undefined,
    respondedByPrincipalId: row.responded_by_principal_id ?? undefined,
    responseNote: row.decision_reason ?? undefined,
  });

  if (!result.success) throwInvalidRow("approval", row.id, result.error);
  return result.data;
}

export interface CreateApprovalInput {
  tenantId: string;
  taskId: string;
  decisionId: string;
  requestedFromPrincipalId: string;
  summary: string;
  status?: Approval["status"];
  requestedBy?: string;
}

export function approvalInputToInsertRow(input: CreateApprovalInput): InsertRow<"approvals"> {
  return {
    tenant_id: input.tenantId,
    task_id: input.taskId,
    authorization_decision_id: input.decisionId,
    requested_from_principal_id: input.requestedFromPrincipalId,
    summary: input.summary,
    status: input.status,
    requested_by: input.requestedBy ?? null,
  };
}

/**
 * Resolving an approval — the one legitimate client-facing update path,
 * gated to security_admin+ by RLS (see `20260923000008_product_rls.sql`).
 */
export interface ResolveApprovalInput {
  status: "approved" | "rejected";
  responseNote?: string;
  /**
   * Optional: an authenticated app user has no guaranteed corresponding
   * `principals` row in this phase (see the Part 2A note that a Principal
   * "may later reference an authenticated user" — that link isn't
   * established everywhere yet). Callers that can resolve one should pass
   * it; the decision is still recorded, with a null responder, when they
   * can't.
   */
  respondedByPrincipalId?: string;
}

export function resolveApprovalToUpdateRow(input: ResolveApprovalInput): UpdateRow<"approvals"> {
  return {
    status: input.status,
    decision_reason: input.responseNote ?? null,
    responded_by_principal_id: input.respondedByPrincipalId ?? null,
    decided_at: new Date().toISOString(),
  };
}
