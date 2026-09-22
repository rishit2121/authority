import { planNodeSchema, planSchema, type Plan, type PlanNode, type PlanNodeStatus, type ToolArguments } from "@/lib/domain";

import { throwInvalidRow } from "../errors";
import type { InsertRow, Tables } from "../db-types";
import { readVersionedJson } from "../versioned-json";

/**
 * Database row → domain `PlanNode`.
 *
 * `node_key`, `operation`, `resource`, `dependencies`, `expected_effect`,
 * `execution_order` and `demo_key` are database-only normalized query
 * fields, dropped here. `sequence_no` maps to the domain's `sequence`;
 * `normalized_arguments` is versioned JSONB whose `values` become the
 * domain's `arguments`.
 */
export function planNodeRowToDomain(row: Tables<"plan_nodes">): PlanNode {
  const argumentsPayload = readVersionedJson(
    row.normalized_arguments,
    [1],
    "plan_nodes.normalized_arguments",
  );

  const result = planNodeSchema.safeParse({
    id: row.id,
    sequence: row.sequence_no,
    tool: row.tool,
    arguments: argumentsPayload.values,
    status: row.status,
    rationale: row.rationale ?? undefined,
  });

  if (!result.success) throwInvalidRow("plan_node", row.id, result.error);
  return result.data;
}

/**
 * Database rows → domain `Plan`.
 *
 * The domain nests `nodes` directly on the plan; the database normalizes
 * them into their own table. This assembles the two — the repository layer
 * is responsible for fetching `nodeRows` for the given plan and passing them
 * in already scoped to it. Nodes are sorted by `sequence_no` regardless of
 * the order the caller supplied them in, since the domain's ordering
 * guarantee comes from `sequence`, not array position.
 */
export function planRowsToDomain(planRow: Tables<"plans">, nodeRows: Tables<"plan_nodes">[]): Plan {
  const nodes = [...nodeRows].sort((a, b) => a.sequence_no - b.sequence_no).map(planNodeRowToDomain);

  const result = planSchema.safeParse({
    id: planRow.id,
    taskId: planRow.task_id,
    nodes,
    proposedAt: planRow.proposed_at,
  });

  if (!result.success) throwInvalidRow("plan", planRow.id, result.error);
  return result.data;
}

export interface CreatePlanInput {
  tenantId: string;
  taskId: string;
  proposedAt?: string;
}

export function planInputToInsertRow(input: CreatePlanInput): InsertRow<"plans"> {
  return {
    tenant_id: input.tenantId,
    task_id: input.taskId,
    proposed_at: input.proposedAt,
  };
}

export interface CreatePlanNodeInput {
  sequence: number;
  tool: string;
  arguments: ToolArguments;
  status?: PlanNodeStatus;
  rationale?: string;
  nodeKey?: string;
  operation?: string;
  resource?: string;
}

/**
 * Builds insert rows for a plan's nodes once the plan's own id is known.
 * Kept separate from `planInputToInsertRow` because the node rows' foreign
 * key can't be filled in until the plan insert has returned an id.
 */
export function planNodesToInsertRows(
  planId: string,
  tenantId: string,
  nodes: CreatePlanNodeInput[],
): InsertRow<"plan_nodes">[] {
  return nodes.map((node, index) => ({
    tenant_id: tenantId,
    plan_id: planId,
    node_key: node.nodeKey ?? `node-${index}`,
    sequence_no: node.sequence,
    tool: node.tool,
    operation: node.operation ?? node.tool.split(".")[1] ?? node.tool,
    resource: node.resource ?? null,
    normalized_arguments: { schemaVersion: 1, values: node.arguments },
    status: node.status,
    rationale: node.rationale ?? null,
  }));
}
