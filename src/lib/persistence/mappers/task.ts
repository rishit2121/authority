import { taskSchema, type Task } from "@/lib/domain";

import { throwInvalidRow } from "../errors";
import type { InsertRow, Tables } from "../db-types";

/**
 * Database row → domain `Task`.
 *
 * `initiating_user_id`, `trusted_context_provenance`, `started_at`,
 * `terminated_at`, `demo_key` and `updated_at` are database-only, dropped
 * here. The domain's `completedAt` is sourced only from `completed_at` — a
 * terminated task's precise termination instant isn't part of the domain
 * Task shape; `terminated_at` exists for the kill switch's own bookkeeping.
 */
export function taskRowToDomain(row: Tables<"tasks">): Task {
  const result = taskSchema.safeParse({
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    principalId: row.principal_id,
    intent: row.intent,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  });

  if (!result.success) throwInvalidRow("task", row.id, result.error);
  return result.data;
}

export interface CreateTaskInput {
  tenantId: string;
  agentId: string;
  principalId: string;
  intent: string;
  status?: Task["status"];
  initiatingUserId?: string;
}

export function taskInputToInsertRow(input: CreateTaskInput): InsertRow<"tasks"> {
  return {
    tenant_id: input.tenantId,
    agent_id: input.agentId,
    principal_id: input.principalId,
    intent: input.intent,
    status: input.status,
    initiating_user_id: input.initiatingUserId ?? null,
  };
}
