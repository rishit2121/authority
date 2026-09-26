import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SemanticDisagreement, SemanticEvidence, SemanticMode } from "@/lib/domain";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type Fn = Database["public"]["Functions"];

export interface SemanticEvaluationContext {
  mode: SemanticMode;
  provider: string;
  model: string;
  timeoutMs: number;
  taskIntent: string;
  tool: string;
  operation: string;
  resource: string | null;
  arguments: unknown;
  decisionOutcome: "allow" | "allow_constrained" | "replan" | "clarify" | "require_approval" | "deny";
  allowedTools: string[];
  priorCalls: unknown;
  existingEvaluationId: string | null;
}

export class SemanticRpcError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string | undefined,
  ) {
    super(`semantic rpc ${operation} failed (code=${code ?? "unknown"})`);
    this.name = "SemanticRpcError";
  }
}

export async function getSemanticEvaluationContext(
  supabase: Client,
  credentialSecret: string,
  decisionId: string,
): Promise<SemanticEvaluationContext> {
  const { data, error } = await supabase.rpc("get_semantic_evaluation_context", {
    p_credential_secret: credentialSecret,
    p_decision_id: decisionId,
  });
  if (error) throw new SemanticRpcError("get_semantic_evaluation_context", error.code);
  const row = data?.[0];
  if (!row) throw new SemanticRpcError("get_semantic_evaluation_context", "no_rows");
  return {
    mode: row.ctx_mode,
    provider: row.ctx_provider,
    model: row.ctx_model,
    timeoutMs: row.ctx_timeout_ms,
    taskIntent: row.ctx_task_intent,
    tool: row.ctx_tool,
    operation: row.ctx_operation,
    resource: row.ctx_resource ?? null,
    arguments: row.ctx_arguments,
    decisionOutcome: row.ctx_decision_outcome,
    allowedTools: row.ctx_allowed_tools ?? [],
    priorCalls: row.ctx_prior_calls,
    existingEvaluationId: row.ctx_existing_evaluation_id ?? null,
  };
}

export interface RecordedSemanticShadow {
  evaluationId: string;
  disagreement: SemanticDisagreement;
  replayed: boolean;
}

export async function recordSemanticShadow(
  supabase: Client,
  credentialSecret: string,
  decisionId: string,
  evidence: SemanticEvidence,
): Promise<RecordedSemanticShadow> {
  const args = {
    p_credential_secret: credentialSecret,
    p_decision_id: decisionId,
    p_provider: evidence.provider,
    p_model: evidence.model,
    p_model_version: evidence.modelVersion,
    p_state: evidence.state,
    p_signals: evidence.signals ? { schemaVersion: 1, ...evidence.signals } : null,
    p_indicators: evidence.indicators,
    p_risk_level: evidence.riskLevel,
    p_confidence: evidence.confidence,
    p_latency_ms: evidence.latencyMs,
    p_input_hash: evidence.inputHash,
    p_redaction_summary: evidence.redaction,
    p_error_category: evidence.errorCategory ?? null,
  } as unknown as Fn["record_semantic_shadow"]["Args"];

  const { data, error } = await supabase.rpc("record_semantic_shadow", args);
  if (error) throw new SemanticRpcError("record_semantic_shadow", error.code);
  const row = data?.[0];
  if (!row) throw new SemanticRpcError("record_semantic_shadow", "no_rows");
  return {
    evaluationId: row.rec_evaluation_id,
    disagreement: row.rec_disagreement,
    replayed: row.rec_replayed,
  };
}

/** Best effort: a failure to audit a failed attempt must never change the response to the caller. */
export async function recordAgentAuthFailure(supabase: Client, credentialSecret: string): Promise<void> {
  try {
    await supabase.rpc("record_agent_auth_failure", { p_credential_secret: credentialSecret });
  } catch {
    // intentionally swallowed
  }
}
