import { toolRequestSchema, type ToolArguments, type ToolRequest } from "@/lib/domain";

import { throwInvalidRow } from "../errors";
import type { InsertRow, Tables } from "../db-types";
import { readVersionedJson } from "../versioned-json";

/**
 * Database row → domain `ToolRequest`.
 *
 * `plan_id`, `operation`, `resource`, `expected_effect`,
 * `destination_metadata`, `provenance`, `idempotency_key` and `demo_key` are
 * database-only, dropped here. The domain ToolRequest is
 * {id, tenantId, taskId, agentId, tool, arguments, planNodeId?, requestedAt}.
 */
export function toolRequestRowToDomain(row: Tables<"tool_requests">): ToolRequest {
  const argumentsPayload = readVersionedJson(
    row.normalized_arguments,
    [1],
    "tool_requests.normalized_arguments",
  );

  const result = toolRequestSchema.safeParse({
    id: row.id,
    tenantId: row.tenant_id,
    taskId: row.task_id,
    agentId: row.agent_id,
    tool: row.tool,
    arguments: argumentsPayload.values,
    planNodeId: row.plan_node_id ?? undefined,
    requestedAt: row.requested_at,
  });

  if (!result.success) throwInvalidRow("tool_request", row.id, result.error);
  return result.data;
}

export interface CreateToolRequestInput {
  tenantId: string;
  taskId: string;
  agentId: string;
  tool: string;
  arguments: ToolArguments;
  idempotencyKey: string;
  planId?: string;
  planNodeId?: string;
  operation?: string;
  resource?: string;
}

export function toolRequestInputToInsertRow(input: CreateToolRequestInput): InsertRow<"tool_requests"> {
  return {
    tenant_id: input.tenantId,
    task_id: input.taskId,
    agent_id: input.agentId,
    tool: input.tool,
    normalized_arguments: { schemaVersion: 1, values: input.arguments },
    idempotency_key: input.idempotencyKey,
    plan_id: input.planId ?? null,
    plan_node_id: input.planNodeId ?? null,
    operation: input.operation ?? input.tool.split(".")[1] ?? input.tool,
    resource: input.resource ?? null,
  };
}
