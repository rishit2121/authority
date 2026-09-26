import "server-only";

import { gatewayQuery } from "./db";
import type { GatewayStatus } from "./rpc";

/**
 * Typed wrappers over the GitHub-connector `gateway.*` functions. Like rpc.ts,
 * none of these returns or logs a request's raw arguments, and no token or key
 * ever passes through them.
 */

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Two-phase execution
// ---------------------------------------------------------------------------

export interface ReserveResult {
  status: GatewayStatus;
  result: "reserved" | "rejected" | "in_progress" | "replayed" | null;
  reasonCode: string | null;
  executionId: string | null;
  capabilityId: string | null;
  taskId: string | null;
  agentId: string | null;
  githubInstallationId: string | null;
  repository: string | null;
  defaultBranch: string | null;
  leaseExpiresAt: string | null;
  previousStatus: string | null;
  previousReceipt: Record<string, unknown> | null;
}

export async function reserveExecution(input: {
  credentialSecret: string;
  tokenHash: string;
  tool: string;
  operation: string;
  resource: string | null;
  args: Record<string, unknown>;
  idempotencyKey: string;
  executionMode: "mock" | "live";
  leaseSeconds: number;
}): Promise<ReserveResult> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.reserve_execution($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::int)`,
    [
      input.credentialSecret,
      input.tokenHash,
      input.tool,
      input.operation,
      input.resource,
      JSON.stringify(input.args),
      input.idempotencyKey,
      input.executionMode,
      input.leaseSeconds,
    ],
  );
  const r = rows[0];
  return {
    status: r.rs_status as GatewayStatus,
    result: (r.rs_result as ReserveResult["result"]) ?? null,
    reasonCode: (r.rs_reason_code as string) ?? null,
    executionId: (r.rs_execution_id as string) ?? null,
    capabilityId: (r.rs_capability_id as string) ?? null,
    taskId: (r.rs_task_id as string) ?? null,
    agentId: (r.rs_agent_id as string) ?? null,
    githubInstallationId: r.rs_github_installation_id == null ? null : String(r.rs_github_installation_id),
    repository: (r.rs_repository as string) ?? null,
    defaultBranch: (r.rs_default_branch as string) ?? null,
    leaseExpiresAt: r.rs_lease_expires_at ? new Date(r.rs_lease_expires_at as string).toISOString() : null,
    previousStatus: (r.rs_prev_category as string) ?? null,
    previousReceipt: (r.rs_prev_receipt as Record<string, unknown>) ?? null,
  };
}

export async function markDispatched(input: {
  executionId: string;
  agentId: string;
}): Promise<{ status: string; reason: string | null }> {
  const rows = await gatewayQuery<Row>(`select * from gateway.mark_dispatched($1::uuid, $2::uuid)`, [
    input.executionId,
    input.agentId,
  ]);
  return { status: rows[0].md_status as string, reason: (rows[0].md_reason as string) ?? null };
}

export type ResultCategory = "succeeded" | "succeeded_noop" | "failed" | "indeterminate" | "released";

export interface FinishInput {
  executionId: string;
  agentId: string;
  category: ResultCategory;
  reasonCode: string | null;
  githubRequestId: string | null;
  httpStatusClass: number | null;
  resourceIds: Record<string, unknown>;
  beforeSha: string | null;
  afterSha: string | null;
  startedAt: Date;
  redaction: Record<string, unknown>;
}

export async function finishExecution(
  input: FinishInput,
): Promise<{ status: string; receiptId: string | null; finalStatus: string | null }> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.finish_execution($1::uuid, $2::uuid, $3, $4, $5, $6::smallint, $7::jsonb, $8, $9, $10::timestamptz, $11::jsonb)`,
    [
      input.executionId,
      input.agentId,
      input.category,
      input.reasonCode,
      input.githubRequestId,
      input.httpStatusClass,
      JSON.stringify({ schemaVersion: 1, ...input.resourceIds }),
      input.beforeSha,
      input.afterSha,
      input.startedAt.toISOString(),
      JSON.stringify({ schemaVersion: 1, ...input.redaction }),
    ],
  );
  return {
    status: rows[0].f_status as string,
    receiptId: (rows[0].f_receipt_id as string) ?? null,
    finalStatus: (rows[0].f_final_status as string) ?? null,
  };
}

export async function reconcileExpiredReservations(limit = 50): Promise<number> {
  const rows = await gatewayQuery<Row>(`select gateway.reconcile_expired_reservations($1::int) as n`, [limit]);
  return Number(rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Runtime approvals (agent-facing status)
// ---------------------------------------------------------------------------

export interface ApprovalStatus {
  status: GatewayStatus;
  approvalId: string | null;
  state: "none" | "not_found" | "pending" | "approved" | "rejected" | "expired" | "stale" | "consumed" | null;
  required: number | null;
  approved: number | null;
  expiresAt: string | null;
  reason: string | null;
}

function mapApproval(r: Row): ApprovalStatus {
  return {
    status: r.a_status as GatewayStatus,
    approvalId: (r.a_approval_id as string) ?? null,
    state: (r.a_state as ApprovalStatus["state"]) ?? null,
    required: (r.a_required as number) ?? null,
    approved: (r.a_approved as number) ?? null,
    expiresAt: r.a_expires_at ? new Date(r.a_expires_at as string).toISOString() : null,
    reason: (r.a_reason as string) ?? null,
  };
}

export async function approvalForRequest(input: {
  credentialSecret: string;
  toolRequestId: string;
}): Promise<ApprovalStatus> {
  const rows = await gatewayQuery<Row>(`select * from gateway.approval_for_request($1, $2::uuid)`, [
    input.credentialSecret,
    input.toolRequestId,
  ]);
  return mapApproval(rows[0]);
}

export async function approvalById(input: {
  credentialSecret: string;
  approvalId: string;
}): Promise<ApprovalStatus & { toolRequestId: string | null }> {
  const rows = await gatewayQuery<Row>(`select * from gateway.approval_by_id($1, $2::uuid)`, [
    input.credentialSecret,
    input.approvalId,
  ]);
  return { ...mapApproval(rows[0]), toolRequestId: (rows[0].a_tool_request_id as string) ?? null };
}

// ---------------------------------------------------------------------------
// Installation administration (actor-verified in SQL)
// ---------------------------------------------------------------------------

export async function beginInstall(input: { tenantId: string; userId: string; nonceHash: string }) {
  const rows = await gatewayQuery<Row>(`select * from gateway.github_begin_install($1::uuid, $2::uuid, $3)`, [
    input.tenantId,
    input.userId,
    input.nonceHash,
  ]);
  return {
    status: rows[0].b_status as string,
    expiresAt: rows[0].b_expires_at ? new Date(rows[0].b_expires_at as string).toISOString() : null,
  };
}

export async function reportInstall(input: {
  tenantId: string;
  userId: string;
  nonceHash: string;
  installationId: string;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.github_report_install($1::uuid, $2::uuid, $3, $4::bigint) as s`,
    [input.tenantId, input.userId, input.nonceHash, input.installationId],
  );
  return rows[0].s as string;
}

export interface InstallationFacts {
  installationId: string;
  accountLogin: string;
  accountType: "User" | "Organization";
  accountId: string;
  repositorySelection: "all" | "selected";
  permissions: Record<string, string>;
  events: string[];
}

export async function completeInstall(input: {
  tenantId: string;
  userId: string;
  nonceHash: string;
  facts: InstallationFacts;
  expectedPermissions: Record<string, string>;
  mode: "mock" | "live";
}): Promise<{ status: string; installationRowId: string | null; health: string | null }> {
  const f = input.facts;
  const rows = await gatewayQuery<Row>(
    `select * from gateway.github_complete_install($1::uuid, $2::uuid, $3, $4::bigint, $5, $6, $7::bigint, $8, $9::jsonb, $10::text[], $11::jsonb, $12)`,
    [
      input.tenantId,
      input.userId,
      input.nonceHash,
      f.installationId,
      f.accountLogin,
      f.accountType,
      f.accountId,
      f.repositorySelection,
      JSON.stringify(f.permissions),
      f.events,
      JSON.stringify(input.expectedPermissions),
      input.mode,
    ],
  );
  return {
    status: rows[0].c_status as string,
    installationRowId: (rows[0].c_installation_row_id as string) ?? null,
    health: (rows[0].c_health as string) ?? null,
  };
}

export interface RepositorySnapshotEntry {
  id: number | string;
  owner: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
}

export async function applyRepositorySnapshot(input: {
  tenantId: string;
  actorUserId: string | null;
  installationRowId: string;
  repositories: RepositorySnapshotEntry[];
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.github_apply_repository_snapshot($1::uuid, $2::uuid, $3::uuid, $4::jsonb) as s`,
    [input.tenantId, input.actorUserId, input.installationRowId, JSON.stringify(input.repositories)],
  );
  return rows[0].s as string;
}

export async function setRepositoryAllowed(input: {
  tenantId: string;
  userId: string;
  repositoryId: string;
  allowed: boolean;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.github_set_repository_allowed($1::uuid, $2::uuid, $3::uuid, $4::boolean) as s`,
    [input.tenantId, input.userId, input.repositoryId, input.allowed],
  );
  return rows[0].s as string;
}

export async function bindTaskRepository(input: {
  tenantId: string;
  userId: string;
  taskId: string;
  repositoryId: string;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.github_bind_task_repository($1::uuid, $2::uuid, $3::uuid, $4::uuid) as s`,
    [input.tenantId, input.userId, input.taskId, input.repositoryId],
  );
  return rows[0].s as string;
}

export async function updateInstallationHealth(input: {
  githubInstallationId: string;
  actorUserId: string | null;
  selection: "all" | "selected";
  permissions: Record<string, string>;
  events: string[];
  suspended: boolean;
  expectedPermissions: Record<string, string>;
}): Promise<{ status: string; health: string | null; reasons: string[] }> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.github_update_health($1::bigint, $2::uuid, $3, $4::jsonb, $5::text[], $6::boolean, $7::jsonb)`,
    [
      input.githubInstallationId,
      input.actorUserId,
      input.selection,
      JSON.stringify(input.permissions),
      input.events,
      input.suspended,
      JSON.stringify(input.expectedPermissions),
    ],
  );
  return {
    status: rows[0].u_status as string,
    health: (rows[0].u_health as string) ?? null,
    reasons: (rows[0].u_reasons as string[]) ?? [],
  };
}

export async function disconnectInstallation(input: {
  tenantId: string;
  userId: string;
  installationRowId: string;
}): Promise<{ status: string; githubInstallationId: string | null; revoked: number }> {
  const rows = await gatewayQuery<Row>(`select * from gateway.github_disconnect($1::uuid, $2::uuid, $3::uuid)`, [
    input.tenantId,
    input.userId,
    input.installationRowId,
  ]);
  return {
    status: rows[0].d_status as string,
    githubInstallationId: rows[0].d_github_installation_id == null ? null : String(rows[0].d_github_installation_id),
    revoked: Number(rows[0].d_revoked ?? 0),
  };
}

export async function applyWebhook(input: {
  deliveryId: string;
  event: string;
  action: string | null;
  githubInstallationId: string;
  removedRepositoryIds: number[];
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.github_apply_webhook($1, $2, $3, $4::bigint, $5::bigint[]) as s`,
    [input.deliveryId, input.event, input.action, input.githubInstallationId, input.removedRepositoryIds],
  );
  return rows[0].s as string;
}

export async function liveInstallation(input: {
  tenantId: string;
  userId: string;
}): Promise<{ rowId: string; githubInstallationId: string; status: string } | null> {
  const rows = await gatewayQuery<Row>(`select * from gateway.github_live_installation($1::uuid, $2::uuid)`, [
    input.tenantId,
    input.userId,
  ]);
  const r = rows[0];
  if (!r) return null;
  return {
    rowId: r.l_row_id as string,
    githubInstallationId: String(r.l_github_installation_id),
    status: r.l_status as string,
  };
}

export async function resolveIndeterminate(input: {
  tenantId: string;
  userId: string;
  executionId: string;
  outcome: "executed" | "not_executed";
  note: string;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.github_resolve_indeterminate($1::uuid, $2::uuid, $3::uuid, $4, $5) as s`,
    [input.tenantId, input.userId, input.executionId, input.outcome, input.note],
  );
  return rows[0].s as string;
}
