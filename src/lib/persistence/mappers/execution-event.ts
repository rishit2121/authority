import { executionEventSchema, type ExecutionEvent } from "@/lib/domain";

import { throwInvalidRow } from "../errors";
import type { InsertRow, Tables } from "../db-types";

/**
 * Database row → domain `ExecutionEvent`.
 *
 * `event_type` maps to the domain's `type`; `result_status` maps to
 * `outcome`; `created_at` maps to `occurredAt`. `tool_request_id`,
 * `normalized_effect_metadata`, `receipt_metadata` and `demo_key` are
 * database-only — the domain ExecutionEvent has no `toolRequestId` field.
 *
 * Append-only at the database layer (no authenticated role holds UPDATE or
 * DELETE, enforced by a trigger that fires even for the table owner — see
 * `20260923000009_lifecycle_triggers.sql`). No update mapper exists here.
 */
export function executionEventRowToDomain(row: Tables<"execution_events">): ExecutionEvent {
  const result = executionEventSchema.safeParse({
    id: row.id,
    tenantId: row.tenant_id,
    taskId: row.task_id,
    type: row.event_type,
    outcome: row.result_status,
    summary: row.summary,
    detail: row.detail ?? undefined,
    decisionId: row.decision_id ?? undefined,
    capabilityId: row.capability_id ?? undefined,
    occurredAt: row.created_at,
  });

  if (!result.success) throwInvalidRow("execution_event", row.id, result.error);
  return result.data;
}

export interface CreateExecutionEventInput {
  tenantId: string;
  taskId: string;
  type: ExecutionEvent["type"];
  outcome: ExecutionEvent["outcome"];
  summary: string;
  detail?: string;
  decisionId?: string;
  capabilityId?: string;
  toolRequestId?: string;
}

export function executionEventInputToInsertRow(
  input: CreateExecutionEventInput,
): InsertRow<"execution_events"> {
  return {
    tenant_id: input.tenantId,
    task_id: input.taskId,
    event_type: input.type,
    result_status: input.outcome,
    summary: input.summary,
    detail: input.detail ?? null,
    decision_id: input.decisionId ?? null,
    capability_id: input.capabilityId ?? null,
    tool_request_id: input.toolRequestId ?? null,
  };
}
