import "server-only";

import type { DecisionQuestion } from "@/lib/openrouter/client";

import {
  RISK_CATEGORIES,
  RISK_CLASSES,
  RISK_EVIDENCE_CODES,
  type JevProviderIdentity,
  type JevRiskCategory,
  type RiskEvidenceCode,
  type ToolRiskEvaluation,
} from "./types";

/**
 * Runtime risk classification input (role C — see docs/jev/OVERVIEW.md). Shadow mode only: this evaluation never
 * gates or changes the deterministic decision (see `lib/gateway/pipeline.ts`). Arguments are a redacted summary
 * (keys/types only, mirroring `lib/semantic/redaction.ts`'s existing approach for the other semantic provider),
 * never raw values, and this never receives a capability token, runtime credential or other secret.
 */
export interface RiskEvaluationInput {
  taskIntent: string;
  tool: string;
  operation: string;
  resource: string | null;
  /** Argument KEYS and coarse types only — never values. */
  argumentKeys: string[];
  contractAllowedTools: string[];
  /** Was this exact tool call part of the proposed plan at all? */
  inProposedPlan: boolean;
  expectedPlanNodeId: string | null;
  priorCallSummaries: Array<{ tool: string; matchedPlan: boolean }>;
  remainingInvocations: number | null;
  contractExpiresInSeconds: number | null;
}

export interface JevRiskProvider extends JevProviderIdentity {
  evaluate(input: RiskEvaluationInput, call: { signal: AbortSignal }): Promise<ToolRiskEvaluation>;
}

export function buildRiskQuestions(): Record<string, DecisionQuestion> {
  const questions: Record<string, DecisionQuestion> = {
    riskClass: {
      type: "choice",
      instructions: "Given the trusted task, the active contract and this exact tool call, how risky is it?",
      criteria: {
        low: "Consistent with the task and the proposed plan; nothing unusual.",
        medium: "Plausible but shows at least one unexplained divergence from the proposed plan or task.",
        high: "Multiple divergences, or one divergence typical of a compromised or manipulated agent.",
        critical:
          "Strong evidence of an attempt to exceed the task's authority (e.g. a different recipient, resource or amount than the task named, secret access, or cross-tenant reach).",
      },
    },
  };
  for (const category of RISK_CATEGORIES.filter((c) => c !== "none")) {
    questions[`category_${category}`] = { type: "noul", instructions: categoryQuestion(category) };
  }
  for (const code of RISK_EVIDENCE_CODES) {
    questions[`evidence_${code}`] = { type: "noul", instructions: evidenceQuestion(code) };
  }
  return questions;
}

function categoryQuestion(category: Exclude<JevRiskCategory, "none">): string {
  const text: Record<Exclude<JevRiskCategory, "none">, string> = {
    prompt_injection:
      "Does this call look like it was produced by content the agent read, rather than the trusted task?",
    task_divergence: "Does this call diverge from what the trusted task actually asked for?",
    resource_substitution: "Does this call target a different resource than the proposed plan named?",
    recipient_substitution: "Does this call address a different recipient than the proposed plan named?",
    argument_escalation: "Does this call use different or broader argument values than the proposed plan?",
    unrequested_side_effect: "Does this call have a side effect the trusted task never asked for?",
    secret_access: "Does this call read or expose credential- or secret-shaped data?",
    cross_tenant_attempt:
      "Does anything about this call suggest it targets another tenant's data or resources?",
    capability_misuse:
      "Does this call look like a reuse or replay of authority granted for a different purpose?",
    suspicious_sequence: "Is this call unusual given the sequence of calls that came before it?",
  };
  return text[category];
}

function evidenceQuestion(code: RiskEvidenceCode): string {
  const text: Record<RiskEvidenceCode, string> = {
    argument_differs_from_plan:
      "Do this call's arguments differ from the corresponding proposed-plan node's arguments?",
    resource_differs_from_plan:
      "Does this call's resource differ from the corresponding proposed-plan node's resource?",
    recipient_differs_from_plan:
      "Does this call's recipient differ from the corresponding proposed-plan node's recipient?",
    amount_exceeds_plan: "Does this call's amount or quantity exceed what the proposed plan specified?",
    operation_not_in_plan: "Is this exact operation absent from the proposed plan entirely?",
    unusual_call_sequence: "Is the order of calls so far unusual for this kind of task?",
    repeated_after_denial: "Was a similar call already denied earlier in this task?",
    near_budget_exhaustion: "Is the remaining invocation budget nearly exhausted?",
    sensitive_resource_pattern:
      "Does the resource name match a pattern typically associated with secrets or credentials?",
    contract_near_expiry: "Is the active contract close to expiring?",
  };
  return text[code];
}

export function mapRiskAnswers(answers: Record<string, unknown>): ToolRiskEvaluation {
  const riskAnswer = answers.riskClass as { choice?: unknown; confidence?: unknown } | undefined;
  const riskClass = RISK_CLASSES.includes(riskAnswer?.choice as never)
    ? (riskAnswer!.choice as ToolRiskEvaluation["riskClass"])
    : "high"; // an unparseable risk classification is never treated as "low"
  const confidence = typeof riskAnswer?.confidence === "number" ? clamp01(riskAnswer.confidence) : 0;

  const yes = (key: string): boolean =>
    (answers[key] as { noul?: unknown } | undefined)?.noul !== undefined
      ? Number((answers[key] as { noul: unknown }).noul) >= 0.5
      : false;

  const categories = RISK_CATEGORIES.filter((c) => c !== "none").filter((c) => yes(`category_${c}`));
  const evidenceCodes = RISK_EVIDENCE_CODES.filter((code) => yes(`evidence_${code}`));

  return { riskClass, confidence, categories: categories.length > 0 ? categories : ["none"], evidenceCodes };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
