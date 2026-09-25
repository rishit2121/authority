import { semanticDecisionResultSchema, type SemanticDecisionResult } from "@/lib/domain";

import { throwInvalidRow } from "../errors";
import type { InsertRow, Tables } from "../db-types";
import { readVersionedJson } from "../versioned-json";

/**
 * Database row → domain `SemanticDecisionResult`.
 *
 * The domain type has no `id`/`tenantId`/`taskId`/`toolRequestId` fields at
 * all — it's meant to be embedded on an `AuthorizationDecision`, not
 * addressed on its own, even though the database gives it its own table and
 * identity for querying. Those four columns, plus `error_category` and
 * `demo_key`, are dropped here.
 */
export function semanticDecisionRowToDomain(row: Tables<"semantic_decisions">): SemanticDecisionResult {
  const probabilities = readVersionedJson(row.probabilities, [1], "semantic_decisions.probabilities");

  const result = semanticDecisionResultSchema.safeParse({
    provider: row.provider,
    model: row.model,
    modelVersion: row.model_version,
    taskRelevanceProbability: probabilities.taskRelevance,
    resourceRelevanceProbability: probabilities.resourceRelevance,
    scopeExpansionProbability: probabilities.scopeExpansion,
    externalDisclosureProbability: probabilities.externalDisclosure,
    planConsistencyProbability: probabilities.planConsistency,
    semanticRiskProbability: probabilities.semanticRisk,
    overallConfidence: row.confidence,
    latencyMs: row.latency_ms,
    state: row.state,
    errorMessage: row.error_message ?? undefined,
    evaluatedAt: row.evaluated_at,
  });

  if (!result.success) throwInvalidRow("semantic_decision", row.id, result.error);
  return result.data;
}

export interface CreateSemanticDecisionInput {
  tenantId: string;
  taskId: string;
  toolRequestId: string;
  result: SemanticDecisionResult;
  errorCategory?: string;
}

export function semanticDecisionInputToInsertRow(
  input: CreateSemanticDecisionInput,
): InsertRow<"semantic_decisions"> {
  const { result } = input;
  return {
    tenant_id: input.tenantId,
    task_id: input.taskId,
    tool_request_id: input.toolRequestId,
    provider: result.provider,
    model: result.model,
    model_version: result.modelVersion,
    probabilities: {
      schemaVersion: 1,
      taskRelevance: result.taskRelevanceProbability,
      resourceRelevance: result.resourceRelevanceProbability,
      scopeExpansion: result.scopeExpansionProbability,
      externalDisclosure: result.externalDisclosureProbability,
      planConsistency: result.planConsistencyProbability,
      semanticRisk: result.semanticRiskProbability,
    },
    confidence: result.overallConfidence,
    latency_ms: result.latencyMs,
    state: result.state,
    error_message: result.errorMessage ?? null,
    error_category: input.errorCategory ?? null,
  };
}
