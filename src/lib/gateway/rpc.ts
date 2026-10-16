import "server-only";

import type { SemanticEvidence } from "@/lib/domain";

import { gatewayQuery } from "./db";

/**
 * Typed wrappers over the `gateway.*` functions. Every function here maps 1:1
 * to a SQL function callable only by the `authority_gateway` role; none of
 * them returns or logs a request's raw arguments.
 */

export type GatewayStatus =
  | "ok"
  | "invalid_credential"
  | "revoked_credential"
  | "rate_limited"
  | "task_not_found"
  | "agent_mismatch"
  | "idempotency_conflict"
  | "no_active_contract"
  | "session_task_mismatch"
  | "session_contract_stale"
  | "session_revoked"
  | "session_expired"
  /** Task alignment: enforcement needs a task-bound credential. */
  | "session_required"
  /** Task alignment: the action review no longer matches the task's state (retried once by the pipeline). */
  | "alignment_stale";

type Outcome = "allow" | "allow_constrained" | "replan" | "clarify" | "require_approval" | "deny";
type Mode = "off" | "shadow" | "enforce";

/**
 * "ok", or "session_required" when this credential is a raw runtime key and the
 * task's application requires task sessions (applications.require_task_sessions).
 * Independent of task alignment and of any AI review setting.
 */
export async function taskCredentialPolicy(
  credentialSecret: string,
  taskId: string,
): Promise<"ok" | "session_required"> {
  const rows = await gatewayQuery<Record<string, unknown>>(
    `select gateway.task_credential_policy($1, $2::uuid) as p`,
    [credentialSecret, taskId],
  );
  return rows[0]?.p === "session_required" ? "session_required" : "ok";
}

export interface PrepareResult {
  status: GatewayStatus;
  mode: Mode;
  provider: string | null;
  model: string | null;
  timeoutMs: number | null;
  required: boolean;
  enforceable: boolean;
  capabilityTtlSeconds: number | null;
  taskIntent: string | null;
  allowedTools: string[];
  priorCalls: unknown;
  detOutcome: Outcome | null;
  alreadyDecided: boolean;
}

export async function prepareAuthorization(input: {
  credentialSecret: string;
  taskId: string;
  tool: string;
  args: Record<string, unknown>;
  idempotencyKey: string;
  registryVersion: string;
  compilerVersion: string;
  riskClass: string;
  maxUses: number;
}): Promise<PrepareResult> {
  const rows = await gatewayQuery<Record<string, unknown>>(
    `select * from gateway.prepare_authorization($1, $2::uuid, $3, $4::jsonb, $5, $6, $7, $8, $9::int)`,
    [
      input.credentialSecret,
      input.taskId,
      input.tool,
      JSON.stringify(input.args),
      input.idempotencyKey,
      input.registryVersion,
      input.compilerVersion,
      input.riskClass,
      input.maxUses,
    ],
  );
  const r = rows[0];
  return {
    status: r.pr_status as GatewayStatus,
    mode: r.pr_mode as Mode,
    provider: (r.pr_provider as string) ?? null,
    model: (r.pr_model as string) ?? null,
    timeoutMs: (r.pr_timeout_ms as number) ?? null,
    required: Boolean(r.pr_required),
    enforceable: Boolean(r.pr_enforceable),
    capabilityTtlSeconds: (r.pr_capability_ttl_seconds as number) ?? null,
    taskIntent: (r.pr_task_intent as string) ?? null,
    allowedTools: (r.pr_allowed_tools as string[]) ?? [],
    priorCalls: r.pr_prior_calls,
    detOutcome: (r.pr_det_outcome as Outcome) ?? null,
    alreadyDecided: Boolean(r.pr_already_decided),
  };
}

export interface CommitResult {
  status: GatewayStatus;
  replayed: boolean;
  decisionId: string | null;
  finalDecisionId: string | null;
  toolRequestId: string | null;
  detOutcome: Outcome | null;
  finalOutcome: Outcome | null;
  reasonCodes: string[];
  contractId: string | null;
  contractVersion: number | null;
  semanticMode: Mode;
  semanticPolicy: string;
  degraded: boolean;
  degradedReason: string | null;
  narrowed: boolean;
  capabilityId: string | null;
  capabilityExpiresAt: string | null;
  capabilityMaxUses: number | null;
  remainingInvocations: number | null;
}

export interface CommitInput {
  credentialSecret: string;
  taskId: string;
  tool: string;
  operation: string;
  resource: string | null;
  args: Record<string, unknown>;
  argumentAudit: unknown;
  planNodeId: string | null;
  idempotencyKey: string;
  registryVersion: string;
  compilerVersion: string;
  riskClass: string;
  maxUses: number;
  tokenHash: string;
  evidence: SemanticEvidence | null;
  gatewayVersion: string;
  registryRequiresApproval: boolean;
}

/**
 * Task-alignment enforcement: the same commit, reached only through
 * gateway.commit_authorization_aligned, which first re-verifies (under the
 * task's lock) that the action review is for exactly these arguments and is
 * still current. Returns status "alignment_stale" otherwise.
 */
export async function commitAuthorizationAligned(
  reviewId: string,
  input: CommitInput,
): Promise<CommitResult> {
  return commitWith(`gateway.commit_authorization_aligned($29::uuid, `, input, [reviewId]);
}

export async function commitAuthorization(input: CommitInput): Promise<CommitResult> {
  return commitWith(`gateway.commit_authorization(`, input, []);
}

async function commitWith(fn: string, input: CommitInput, extra: unknown[]): Promise<CommitResult> {
  const e = input.evidence;
  const rows = await gatewayQuery<Record<string, unknown>>(
    `select * from ${fn}
       $1, $2::uuid, $3, $4, $5, $6::jsonb, $7::jsonb, $8::uuid, $9, $10, $11, $12, $13::int, $14,
       $15, $16, $17, $18::public.semantic_evidence_state, $19::jsonb, $20::text[], $21::public.semantic_risk_level,
       $22::double precision, $23::int, $24, $25::jsonb, $26, $27, $28::boolean)`,
    [
      input.credentialSecret,
      input.taskId,
      input.tool,
      input.operation,
      input.resource,
      JSON.stringify(input.args),
      JSON.stringify(input.argumentAudit),
      input.planNodeId,
      input.idempotencyKey,
      input.registryVersion,
      input.compilerVersion,
      input.riskClass,
      input.maxUses,
      input.tokenHash,
      e?.provider ?? null,
      e?.model ?? null,
      e?.modelVersion ?? null,
      e?.state ?? null,
      e?.signals ? JSON.stringify({ schemaVersion: 1, ...e.signals }) : null,
      e?.indicators ?? null,
      e?.riskLevel ?? null,
      e?.confidence ?? null,
      e?.latencyMs ?? null,
      e?.inputHash ?? null,
      e ? JSON.stringify(e.redaction) : null,
      e?.errorCategory ?? null,
      input.gatewayVersion,
      input.registryRequiresApproval,
      ...extra,
    ],
  );
  const r = rows[0];
  return {
    status: r.r_status as GatewayStatus,
    replayed: Boolean(r.r_replayed),
    decisionId: (r.r_decision_id as string) ?? null,
    finalDecisionId: (r.r_final_decision_id as string) ?? null,
    toolRequestId: (r.r_tool_request_id as string) ?? null,
    detOutcome: (r.r_det_outcome as Outcome) ?? null,
    finalOutcome: (r.r_final_outcome as Outcome) ?? null,
    reasonCodes: (r.r_reason_codes as string[]) ?? [],
    contractId: (r.r_contract_id as string) ?? null,
    contractVersion: (r.r_contract_version as number) ?? null,
    semanticMode: r.r_semantic_mode as Mode,
    semanticPolicy: r.r_semantic_policy as string,
    degraded: Boolean(r.r_degraded),
    degradedReason: (r.r_degraded_reason as string) ?? null,
    narrowed: Boolean(r.r_narrowed),
    capabilityId: (r.r_capability_id as string) ?? null,
    capabilityExpiresAt: r.r_capability_expires_at
      ? new Date(r.r_capability_expires_at as string).toISOString()
      : null,
    capabilityMaxUses: (r.r_capability_max_uses as number) ?? null,
    remainingInvocations: (r.r_remaining_invocations as number) ?? null,
  };
}

export interface ConsumeResult {
  status: GatewayStatus;
  result: "accepted" | "rejected" | null;
  reasonCode: string | null;
  capabilityId: string | null;
  remainingUses: number | null;
  expiresAt: string | null;
  replayed: boolean;
}

export async function consumeCapability(input: {
  credentialSecret: string;
  tokenHash: string;
  tool: string;
  operation: string;
  resource: string | null;
  args: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<ConsumeResult> {
  const rows = await gatewayQuery<Record<string, unknown>>(
    `select * from gateway.consume_capability($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      input.credentialSecret,
      input.tokenHash,
      input.tool,
      input.operation,
      input.resource,
      JSON.stringify(input.args),
      input.idempotencyKey,
    ],
  );
  const r = rows[0];
  return {
    status: r.cs_status as GatewayStatus,
    result: (r.cs_result as ConsumeResult["result"]) ?? null,
    reasonCode: (r.cs_reason_code as string) ?? null,
    capabilityId: (r.cs_capability_id as string) ?? null,
    remainingUses: (r.cs_remaining_uses as number) ?? null,
    expiresAt: r.cs_expires_at ? new Date(r.cs_expires_at as string).toISOString() : null,
    replayed: Boolean(r.cs_replayed),
  };
}

export async function revokeCapabilityViaGateway(input: {
  credentialSecret: string;
  capabilityId: string;
  reason: string;
}): Promise<{ status: GatewayStatus; result: string | null }> {
  const rows = await gatewayQuery<Record<string, unknown>>(
    `select * from gateway.revoke_capability($1, $2::uuid, $3)`,
    [input.credentialSecret, input.capabilityId, input.reason],
  );
  return { status: rows[0].rv_status as GatewayStatus, result: (rows[0].rv_result as string) ?? null };
}

export async function gatewayPing(): Promise<boolean> {
  const rows = await gatewayQuery<{ ping: boolean }>(`select gateway.ping() as ping`);
  return rows[0]?.ping === true;
}

/** Side-effect-free; returns null for an unknown or deleted task. See gateway.tenant_for_task's own comment for why this exists alongside credential resolution rather than replacing it. */
export async function tenantForTask(taskId: string): Promise<string | null> {
  const rows = await gatewayQuery<{ tenant_for_task: string | null }>(
    `select gateway.tenant_for_task($1::uuid) as tenant_for_task`,
    [taskId],
  );
  return rows[0]?.tenant_for_task ?? null;
}

export interface ActiveContractSummary {
  contractId: string;
  version: number;
  /** Each item's shape matches src/lib/domain/task-authority-contract.ts's own allowedActionSchema. */
  allowedActions: Array<{ tool: string; constraints: unknown[]; maxInvocations?: number }>;
}

/** Side-effect-free; returns null when the task has no currently active contract. See gateway.active_contract_for_task's own comment -- discovery only, grants nothing by itself. */
export async function activeContractForTask(taskId: string): Promise<ActiveContractSummary | null> {
  const rows = await gatewayQuery<{
    acft_contract_id: string;
    acft_version: number;
    acft_allowed_actions: unknown;
  }>(`select * from gateway.active_contract_for_task($1::uuid)`, [taskId]);
  const r = rows[0];
  if (!r) return null;
  // allowed_actions is versioned JSONB ({schemaVersion, items}), same
  // envelope src/lib/persistence/mappers/contract.ts unwraps for the
  // RLS-governed app repository's own read of this column.
  const payload = r.acft_allowed_actions as { items?: ActiveContractSummary["allowedActions"] } | null;
  return { contractId: r.acft_contract_id, version: r.acft_version, allowedActions: payload?.items ?? [] };
}
