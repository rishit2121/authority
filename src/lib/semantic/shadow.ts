import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toolArgumentsSchema, type SemanticObservationResponse } from "@/lib/domain";
import {
  getSemanticEvaluationContext,
  recordSemanticShadow,
  type SemanticEvaluationContext,
} from "@/lib/runtime/semantic-rpc";
import type { Database } from "@/lib/supabase/database.types";

import { breakerFor, type CircuitBreaker } from "./circuit-breaker";
import { createSemanticProvider, resolveEffectiveMode } from "./config";
import type { SemanticRiskProvider } from "./provider";
import { runSemanticEvaluation } from "./runner";
import { z } from "zod";

const NOT_AUTHORITATIVE_NOTE =
  "Shadow only — this observation did not affect the authorization decision and is not authenticated enforcement evidence.";

const priorCallsSchema = z.array(z.object({ tool: z.string(), arguments: toolArgumentsSchema })).max(5);

export interface ShadowDeps {
  createProvider?: (name: string, model: string) => SemanticRiskProvider;
  breakerFor?: (key: string) => CircuitBreaker;
  getContext?: typeof getSemanticEvaluationContext;
  record?: typeof recordSemanticShadow;
}

function base(
  mode: SemanticObservationResponse["mode"],
  status: SemanticObservationResponse["status"],
  note: string,
) {
  return { mode, authoritative: false as const, affectedAuthorization: false as const, status, note };
}

/**
 * Runs the whole shadow flow for one already-made deterministic decision and
 * returns the separately-labeled observation to hand back to the caller.
 *
 * It *never throws* and never touches the deterministic record: every failure
 * (context lookup, provider, recording) becomes a status on the observation.
 * Its only inputs beyond the credential and decision id come from persisted
 * rows fetched by the database, so what gets evaluated is what was actually
 * recorded — not what the caller says it was.
 */
export async function runSemanticShadowForDecision(
  supabase: SupabaseClient<Database>,
  credentialSecret: string,
  decisionId: string,
  deps: ShadowDeps = {},
): Promise<SemanticObservationResponse> {
  let ctx: SemanticEvaluationContext;
  try {
    ctx = await (deps.getContext ?? getSemanticEvaluationContext)(supabase, credentialSecret, decisionId);
  } catch {
    return base(
      "off",
      "record_failed",
      "Semantic context could not be loaded; the deterministic decision is unaffected.",
    );
  }

  const { effective, enforcementUnavailable } = resolveEffectiveMode(ctx.mode);
  if (enforcementUnavailable) {
    return base(
      "off",
      "enforcement_unavailable",
      "Semantic enforcement is unavailable; no semantic evaluation ran.",
    );
  }
  if (effective === "off") return base("off", "disabled", "Semantic evaluation is off for this workspace.");

  if (ctx.existingEvaluationId) {
    return {
      ...base(
        "shadow",
        "replayed",
        `A semantic observation was already recorded for this decision. ${NOT_AUTHORITATIVE_NOTE}`,
      ),
      evaluationId: ctx.existingEvaluationId,
    };
  }

  const args = toolArgumentsSchema.safeParse(ctx.arguments);
  const prior = priorCallsSchema.safeParse(ctx.priorCalls);
  if (!args.success || !prior.success) {
    return base("shadow", "record_failed", "Stored request could not be prepared for semantic evaluation.");
  }

  const provider = (deps.createProvider ?? createSemanticProvider)(ctx.provider, ctx.model);
  const breaker = (deps.breakerFor ?? breakerFor)(`${provider.name}:${provider.model}`);

  const { evidence } = await runSemanticEvaluation({
    provider,
    breaker,
    timeoutMs: ctx.timeoutMs,
    input: {
      taskIntent: ctx.taskIntent,
      tool: ctx.tool,
      operation: ctx.operation,
      resource: ctx.resource,
      arguments: args.data,
      contractAllowedTools: ctx.allowedTools,
      priorCalls: prior.data,
    },
  });

  const observation = {
    mode: "shadow" as const,
    authoritative: false as const,
    affectedAuthorization: false as const,
    evidenceState: evidence.state,
    riskLevel: evidence.riskLevel,
    signals: evidence.signals,
    indicators: evidence.indicators,
    confidence: evidence.confidence,
    provider: evidence.provider,
    model: evidence.model,
    modelVersion: evidence.modelVersion,
    latencyMs: evidence.latencyMs,
  };

  try {
    const recorded = await (deps.record ?? recordSemanticShadow)(
      supabase,
      credentialSecret,
      decisionId,
      evidence,
    );
    return {
      ...observation,
      status: recorded.replayed ? "replayed" : "evaluated",
      disagreement: recorded.disagreement,
      evaluationId: recorded.evaluationId,
      note: NOT_AUTHORITATIVE_NOTE,
    };
  } catch {
    return {
      ...observation,
      status: "record_failed",
      note: `The observation could not be persisted. ${NOT_AUTHORITATIVE_NOTE}`,
    };
  }
}
