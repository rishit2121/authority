import "server-only";

import { gatewayQuery } from "@/lib/gateway/db";

import type { RiskRunResult } from "./risk-runner";

/** Side-effect-free: does not touch rate limiting, auth events or `last_used_at` (unlike `resolve_credential`). Returns "off" for an unknown/deleted task rather than throwing. */
export async function jevRiskModeForTask(
  taskId: string,
): Promise<{ tenantId: string | null; mode: "off" | "shadow" }> {
  try {
    const rows = await gatewayQuery<{ jc_tenant_id: string; jc_risk_mode: string }>(
      `select * from gateway.jev_risk_mode_for_task($1::uuid)`,
      [taskId],
    );
    const row = rows[0];
    return { tenantId: row?.jc_tenant_id ?? null, mode: row?.jc_risk_mode === "shadow" ? "shadow" : "off" };
  } catch {
    return { tenantId: null, mode: "off" };
  }
}

export interface RecordRiskEvaluationInput {
  tenantId: string;
  taskId: string;
  toolRequestId: string;
  authorizationDecisionId: string;
  run: RiskRunResult;
  inputHash: string;
  deterministicDecision: string;
  finalDecision: string;
  disagreement: boolean;
}

/**
 * Records shadow-mode Jev risk evidence via the restricted `authority_gateway` role — the same pool used for every
 * other gateway write, never the caller's own session. Called AFTER `commitAuthorization` has already succeeded, so
 * a Jev outage (or this write itself failing) can never affect the authorization decision it describes. Never
 * throws: an audit-trail write failing must not surface as a runtime authorization error to the agent.
 */
export async function recordRiskEvaluation(input: RecordRiskEvaluationInput): Promise<void> {
  try {
    await gatewayQuery(`select gateway.record_jev_risk_evaluation($1::uuid, $2::jsonb)`, [
      input.tenantId,
      JSON.stringify({
        taskId: input.taskId,
        toolRequestId: input.toolRequestId,
        authorizationDecisionId: input.authorizationDecisionId,
        provider: input.run.provider,
        model: input.run.model,
        modelVersion: input.run.modelVersion,
        inputHash: input.inputHash,
        state: input.run.state,
        result: input.run.evaluation ? { schemaVersion: 1, ...input.run.evaluation } : null,
        deterministicDecision: input.deterministicDecision,
        finalDecision: input.finalDecision,
        disagreement: input.disagreement,
        latencyMs: input.run.latencyMs,
        errorCategory: input.run.errorCategory,
      }),
    ]);
  } catch {
    // Deliberately swallowed — see module doc. `gatewayQuery` already scrubs and logs the SQLSTATE.
  }
}
