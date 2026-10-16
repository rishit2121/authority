import "server-only";

import type { AlignmentMode, AlignmentPolicy, ContentStatus, ReviewOutcome } from "@/lib/alignment/types";

import { gatewayQuery } from "./db";

/** Gateway-role wrappers for task alignment (20261015000003_task_alignment_foundation.sql). */

type Row = Record<string, unknown>;

export type CredentialKind = "backend" | "session" | "runtime_key";

export interface AlignmentContext {
  status: string;
  credentialKind: CredentialKind | null;
  tenantId: string | null;
  applicationId: string | null;
  mode: AlignmentMode;
  policy: AlignmentPolicy;
  maxContentBytes: number;
  objectiveVersion: number;
  contextRevision: number;
  taskIntent: string | null;
  objectiveRequest: string | null;
  objectiveExtraction: unknown;
  objectiveStatus: string | null;
  contractId: string | null;
  allowedActions: unknown;
  checkPlans: boolean;
  checkContent: boolean;
  checkActions: boolean;
  /** Latest plan review of the active contract under the current objectives, if any. */
  planOutcome: string | null;
  planDecision: string | null;
  /** Content screening behavior: report findings only, or withhold flagged content. */
  contentAction: "report" | "quarantine";
}

export async function alignmentContext(secret: string, taskId: string): Promise<AlignmentContext> {
  const rows = await gatewayQuery<Row>(`select * from gateway.alignment_context($1, $2::uuid)`, [
    secret,
    taskId,
  ]);
  const r = rows[0] ?? {};
  return {
    status: (r.ac_status as string) ?? "error",
    credentialKind: (r.ac_credential_kind as CredentialKind) ?? null,
    tenantId: (r.ac_tenant_id as string) ?? null,
    applicationId: (r.ac_application_id as string) ?? null,
    mode: ((r.ac_mode as string) ?? "off") as AlignmentMode,
    policy: ((r.ac_policy as string) ?? "production") as AlignmentPolicy,
    maxContentBytes: (r.ac_max_content_bytes as number) ?? 32768,
    objectiveVersion: (r.ac_objective_version as number) ?? 0,
    contextRevision: (r.ac_context_revision as number) ?? 0,
    taskIntent: (r.ac_task_intent as string) ?? null,
    objectiveRequest: (r.ac_objective_request as string) ?? null,
    objectiveExtraction: r.ac_objective_extraction ?? null,
    objectiveStatus: (r.ac_objective_status as string) ?? null,
    contractId: (r.ac_contract_id as string) ?? null,
    allowedActions: r.ac_allowed_actions ?? null,
    checkPlans: r.ac_check_plans !== false,
    checkContent: r.ac_check_content === true,
    checkActions: r.ac_check_actions !== false,
    planOutcome: (r.ac_plan_outcome as string) ?? null,
    planDecision: (r.ac_plan_decision as string) ?? null,
    contentAction: r.ac_content_action === "quarantine" ? "quarantine" : "report",
  };
}

export async function recordTaskObjectives(input: {
  secret: string;
  taskId: string;
  source: "original_request" | "application_update";
  requestText: string;
  extraction: unknown;
  status: "extracted" | "unreviewed";
  reviewer: unknown;
  expectedVersion: number;
}): Promise<{ status: string; version: number | null }> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.record_task_objectives($1, $2::uuid, $3, $4, $5::jsonb, $6, $7::jsonb, $8)`,
    [
      input.secret,
      input.taskId,
      input.source,
      input.requestText,
      JSON.stringify(input.extraction),
      input.status,
      JSON.stringify(input.reviewer ?? {}),
      input.expectedVersion,
    ],
  );
  return { status: rows[0].rto_status as string, version: (rows[0].rto_version as number) ?? null };
}

export interface ReviewRecord {
  secret: string;
  taskId: string;
  kind: "plan" | "content" | "action";
  mode: "shadow" | "enforce";
  policy: AlignmentPolicy;
  subjectHash: string;
  objectiveVersion: number;
  contextRevision: number;
  contractId: string | null;
  idempotencyKey: string | null;
  outcome: ReviewOutcome;
  findings: unknown;
  scores: unknown;
  feedback: string | null;
  reviewer: unknown;
  usage: unknown;
}

export async function recordAlignmentReview(
  input: ReviewRecord,
): Promise<{ status: string; reviewId: string | null }> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.record_alignment_review($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid, $10, $11, $12::jsonb, $13::jsonb, $14, $15::jsonb, $16::jsonb)`,
    [
      input.secret,
      input.taskId,
      input.kind,
      input.mode,
      input.policy,
      input.subjectHash,
      input.objectiveVersion,
      input.contextRevision,
      input.contractId,
      input.idempotencyKey,
      input.outcome,
      JSON.stringify(input.findings ?? []),
      JSON.stringify(input.scores ?? []),
      input.feedback ? input.feedback.slice(0, 4000) : null,
      JSON.stringify(input.reviewer ?? {}),
      JSON.stringify(input.usage ?? {}),
    ],
  );
  return { status: rows[0].rar_status as string, reviewId: (rows[0].rar_review_id as string) ?? null };
}

export interface FoundReview {
  status: string;
  reviewId: string | null;
  outcome: ReviewOutcome | null;
  decision: "approved" | "rejected" | null;
  findings: unknown;
  scores: unknown;
  feedback: string | null;
  policy: AlignmentPolicy | null;
  mode: "shadow" | "enforce" | null;
  contractId: string | null;
}

export async function findAlignmentReview(input: {
  secret: string;
  taskId: string;
  kind: "plan" | "content" | "action";
  subjectHash: string;
  objectiveVersion: number;
  contextRevision: number | null;
}): Promise<FoundReview> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.find_alignment_review($1, $2::uuid, $3, $4, $5, $6)`,
    [
      input.secret,
      input.taskId,
      input.kind,
      input.subjectHash,
      input.objectiveVersion,
      input.contextRevision,
    ],
  );
  const r = rows[0];
  if (!r)
    return {
      status: "not_found",
      reviewId: null,
      outcome: null,
      decision: null,
      findings: null,
      scores: null,
      feedback: null,
      policy: null,
      mode: null,
      contractId: null,
    };
  return {
    status: r.far_status as string,
    reviewId: (r.far_review_id as string) ?? null,
    outcome: (r.far_outcome as ReviewOutcome) ?? null,
    decision: (r.far_decision as FoundReview["decision"]) ?? null,
    findings: r.far_findings ?? null,
    scores: r.far_scores ?? null,
    feedback: (r.far_feedback as string) ?? null,
    policy: (r.far_policy as AlignmentPolicy) ?? null,
    mode: (r.far_mode as FoundReview["mode"]) ?? null,
    contractId: (r.far_contract_id as string) ?? null,
  };
}

export async function recordExternalContent(input: {
  secret: string;
  taskId: string;
  reviewId: string | null;
  origin: "api" | "connector";
  sourceKind: string;
  sourceLabel: string | null;
  sourceUri: string | null;
  contentType: string;
  contentHash: string;
  byteSize: number;
  status: ContentStatus;
  receiptId: string | null;
  retainContent: string | null;
  retentionSeconds: number | null;
}): Promise<{ status: string; itemId: string | null; contextRevision: number | null }> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.record_external_content($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid, $13, $14)`,
    [
      input.secret,
      input.taskId,
      input.reviewId,
      input.origin,
      input.sourceKind,
      input.sourceLabel,
      input.sourceUri,
      input.contentType,
      input.contentHash,
      input.byteSize,
      input.status,
      input.receiptId,
      input.retainContent,
      input.retentionSeconds,
    ],
  );
  const r = rows[0];
  return {
    status: r.rec_status as string,
    itemId: (r.rec_item_id as string) ?? null,
    contextRevision: (r.rec_context_revision as number) ?? null,
  };
}

export interface ExternalContentStatus {
  status: string;
  taskId: string | null;
  itemStatus: ContentStatus | null;
  decision: "approved" | "rejected" | null;
  contentHash: string | null;
  contextRevision: number | null;
  findings: unknown;
  content: string | null;
}

export async function getExternalContent(secret: string, itemId: string): Promise<ExternalContentStatus> {
  const rows = await gatewayQuery<Row>(`select * from gateway.get_external_content($1, $2::uuid)`, [
    secret,
    itemId,
  ]);
  const r = rows[0];
  return {
    status: r.gec_status as string,
    taskId: (r.gec_task_id as string) ?? null,
    itemStatus: (r.gec_item_status as ContentStatus) ?? null,
    decision: (r.gec_decision as ExternalContentStatus["decision"]) ?? null,
    contentHash: (r.gec_content_hash as string) ?? null,
    contextRevision: (r.gec_context_revision as number) ?? null,
    findings: r.gec_findings ?? null,
    content: (r.gec_content as string) ?? null,
  };
}

export interface ActionReviewRecord {
  secret: string;
  taskId: string;
  tool: string;
  operation: string;
  resource: string | null;
  args: Record<string, unknown>;
  idempotencyKey: string;
  mode: "shadow" | "enforce";
  policy: AlignmentPolicy;
  objectiveVersion: number;
  contextRevision: number;
  contractId: string | null;
  outcome: ReviewOutcome;
  findings: unknown;
  scores: unknown;
  feedback: string | null;
  reviewer: unknown;
  usage: unknown;
}

/** The subject hash is computed in SQL from the same jsonb the commit receives (alignment_action_subject). */
export async function recordActionReview(
  input: ActionReviewRecord,
): Promise<{ status: string; reviewId: string | null }> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.record_action_review($1, $2::uuid, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12::uuid, $13, $14::jsonb, $15::jsonb, $16, $17::jsonb, $18::jsonb)`,
    [
      input.secret,
      input.taskId,
      input.tool,
      input.operation,
      input.resource,
      JSON.stringify(input.args),
      input.idempotencyKey,
      input.mode,
      input.policy,
      input.objectiveVersion,
      input.contextRevision,
      input.contractId,
      input.outcome,
      JSON.stringify(input.findings ?? []),
      JSON.stringify(input.scores ?? []),
      input.feedback ? input.feedback.slice(0, 4000) : null,
      JSON.stringify(input.reviewer ?? {}),
      JSON.stringify(input.usage ?? {}),
    ],
  );
  return { status: rows[0].rar_status as string, reviewId: (rows[0].rar_review_id as string) ?? null };
}

export interface FoundActionReview {
  status: string;
  reviewId: string | null;
  outcome: ReviewOutcome | null;
  decision: "approved" | "rejected" | null;
  findings: unknown;
  feedback: string | null;
  policy: AlignmentPolicy | null;
  mode: "shadow" | "enforce" | null;
}

export async function findActionReview(input: {
  secret: string;
  taskId: string;
  tool: string;
  operation: string;
  resource: string | null;
  args: Record<string, unknown>;
  idempotencyKey: string;
  objectiveVersion: number;
  contextRevision: number;
}): Promise<FoundActionReview> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.find_action_review($1, $2::uuid, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
    [
      input.secret,
      input.taskId,
      input.tool,
      input.operation,
      input.resource,
      JSON.stringify(input.args),
      input.idempotencyKey,
      input.objectiveVersion,
      input.contextRevision,
    ],
  );
  const r = rows[0];
  if (!r)
    return {
      status: "not_found",
      reviewId: null,
      outcome: null,
      decision: null,
      findings: null,
      feedback: null,
      policy: null,
      mode: null,
    };
  return {
    status: r.far_status as string,
    reviewId: (r.far_review_id as string) ?? null,
    outcome: (r.far_outcome as ReviewOutcome) ?? null,
    decision: (r.far_decision as FoundActionReview["decision"]) ?? null,
    findings: r.far_findings ?? null,
    feedback: (r.far_feedback as string) ?? null,
    policy: (r.far_policy as AlignmentPolicy) ?? null,
    mode: (r.far_mode as FoundActionReview["mode"]) ?? null,
  };
}
