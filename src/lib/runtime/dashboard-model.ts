import { summarizeReasonCodes } from "./reason-codes";
import type { SemanticEvidenceView } from "@/lib/semantic/read-model";
import { classifyDisagreement } from "@/lib/semantic/risk";

/**
 * View model for the runtime dashboard: one row per runtime decision, joining
 * the deterministic decision, the final composed decision, the semantic
 * evidence and the capability's lifecycle. Pure, so it is unit-tested.
 *
 * Decisions recorded before Part 6 have no final-decision row; they are shown
 * as `pre-gateway` with the deterministic outcome standing as the final one,
 * never rewritten.
 */

export type CapabilityState = "active" | "consumed" | "revoked" | "expired";

export interface DecisionInput {
  id: string;
  outcome: string;
  reason_codes: unknown;
  contract_id: string | null;
  contract_version: number | null;
  tool_request_id: string;
  created_at: string;
}
export interface RequestInput {
  id: string;
  tool: string;
  operation: string;
  resource: string | null;
  task_id: string;
  agent_id: string;
  arguments_redacted: boolean;
}
export interface FinalInput {
  id: string;
  authorization_decision_id: string;
  deterministic_outcome: string;
  final_outcome: string;
  semantic_mode: string;
  semantic_policy: string;
  risk_class: string;
  composition_reasons: string[];
  degraded: boolean;
  degraded_reason: string | null;
  narrowed: boolean;
}
export interface TokenInput {
  id: string;
  final_decision_id: string;
  issued_at: string;
  expires_at: string;
  max_uses: number;
  uses: number;
  status: string;
  revoked_by: string | null;
  revocation_reason: string | null;
}
export interface ConsumptionInput {
  capability_id: string;
  result: string;
  reason_code: string;
}

export interface CapabilityView {
  id: string;
  state: CapabilityState;
  issuedAt: string;
  expiresAt: string;
  ttlRemainingSeconds: number;
  uses: number;
  maxUses: number;
  remainingUses: number;
  acceptedConsumptions: number;
  replayAttempts: number;
  rejectedAttempts: number;
  revokedBy: string | null;
  revocationReason: string | null;
}

export interface RuntimeRow {
  decisionId: string;
  createdAt: string;
  agentId: string;
  agentName: string;
  taskId: string;
  tool: string;
  operation: string;
  resource: string | null;
  argumentsRedacted: boolean;
  deterministic: string;
  final: string;
  gateway: boolean;
  semanticMode: string;
  semanticPolicy: string;
  riskClass: string | null;
  degraded: boolean;
  degradedReason: string | null;
  narrowed: boolean;
  deterministicReasonCodes: string[];
  compositionReasonCodes: string[];
  contractVersion: number | null;
  evidence: SemanticEvidenceView | undefined;
  capability: CapabilityView | null;
}

export function effectiveCapabilityState(
  token: Pick<TokenInput, "status" | "expires_at">,
  now: Date = new Date(),
): CapabilityState {
  if (token.status === "revoked") return "revoked";
  if (token.status === "consumed") return "consumed";
  return new Date(token.expires_at).getTime() <= now.getTime() ? "expired" : "active";
}

function reasonCodes(value: unknown): string[] {
  const items = (value as { items?: { code?: string }[] } | null)?.items;
  return Array.isArray(items) ? items.map((i) => i.code ?? "").filter(Boolean) : [];
}

export function buildRuntimeRows(input: {
  decisions: DecisionInput[];
  requests: RequestInput[];
  finals: FinalInput[];
  tokens: TokenInput[];
  consumptions: ConsumptionInput[];
  evidenceByDecision: Map<string, SemanticEvidenceView>;
  agentNames: Map<string, string>;
  now?: Date;
}): RuntimeRow[] {
  const now = input.now ?? new Date();
  const requestById = new Map(input.requests.map((r) => [r.id, r]));
  const finalByDecision = new Map(input.finals.map((f) => [f.authorization_decision_id, f]));
  const tokenByFinal = new Map(input.tokens.map((t) => [t.final_decision_id, t]));

  const rows: RuntimeRow[] = [];
  for (const d of input.decisions) {
    const req = requestById.get(d.tool_request_id);
    if (!req) continue;
    const f = finalByDecision.get(d.id);
    const t = f ? tokenByFinal.get(f.id) : undefined;

    let capability: CapabilityView | null = null;
    if (t) {
      const mine = input.consumptions.filter((c) => c.capability_id === t.id);
      capability = {
        id: t.id,
        state: effectiveCapabilityState(t, now),
        issuedAt: t.issued_at,
        expiresAt: t.expires_at,
        ttlRemainingSeconds: Math.max(
          0,
          Math.round((new Date(t.expires_at).getTime() - now.getTime()) / 1000),
        ),
        uses: t.uses,
        maxUses: t.max_uses,
        remainingUses: t.max_uses - t.uses,
        acceptedConsumptions: mine.filter((c) => c.result === "accepted").length,
        replayAttempts: mine.filter((c) => c.reason_code === "CAPABILITY_ALREADY_USED").length,
        rejectedAttempts: mine.filter((c) => c.result === "rejected").length,
        revokedBy: t.revoked_by,
        revocationReason: t.revocation_reason,
      };
    }

    rows.push({
      decisionId: d.id,
      createdAt: d.created_at,
      agentId: req.agent_id,
      agentName: input.agentNames.get(req.agent_id) ?? "unknown",
      taskId: req.task_id,
      tool: req.tool,
      operation: req.operation,
      resource: req.resource,
      argumentsRedacted: req.arguments_redacted,
      deterministic: d.outcome,
      final: f?.final_outcome ?? d.outcome,
      gateway: Boolean(f),
      semanticMode: f?.semantic_mode ?? (input.evidenceByDecision.has(d.id) ? "shadow" : "off"),
      semanticPolicy: f?.semantic_policy ?? "not_applicable",
      riskClass: f?.risk_class ?? null,
      degraded: f?.degraded ?? false,
      degradedReason: f?.degraded_reason ?? null,
      narrowed: f?.narrowed ?? false,
      deterministicReasonCodes: reasonCodes(d.reason_codes),
      compositionReasonCodes: f?.composition_reasons ?? [],
      contractVersion: d.contract_version,
      evidence: (() => {
        const e = input.evidenceByDecision.get(d.id);
        // Disagreement is always derived here from the two decisions (mirrors the database function).
        return e
          ? {
              ...e,
              disagreement: classifyDisagreement(
                d.outcome as Parameters<typeof classifyDisagreement>[0],
                e.riskLevel as Parameters<typeof classifyDisagreement>[1],
              ),
            }
          : undefined;
      })(),
      capability,
    });
  }
  return rows;
}

export interface TraceStep {
  step: string;
  detail: string;
}

/** The decision trace shown in the dashboard's row detail. */
export function decisionTrace(row: RuntimeRow): TraceStep[] {
  const steps: TraceStep[] = [
    {
      step: "Gateway",
      detail: row.gateway
        ? "Authenticated via the trusted gateway (agent runtime key)."
        : "Recorded before the Part 6 gateway existed; no final-decision record.",
    },
    {
      step: "Deterministic",
      detail: `${row.deterministic} — ${summarizeReasonCodes(row.deterministicReasonCodes)}`,
    },
  ];
  if (row.evidence) {
    steps.push({
      step: "Semantic",
      detail: `${row.semanticMode} · ${row.evidence.provider} · ${row.evidence.state}${row.evidence.state === "ok" ? ` · risk ${row.evidence.riskLevel}` : ""}`,
    });
  } else {
    steps.push({
      step: "Semantic",
      detail: row.semanticMode === "off" ? "Off — not evaluated." : "No evidence recorded.",
    });
  }
  if (row.gateway) {
    const why = row.compositionReasonCodes.length
      ? ` — ${summarizeReasonCodes(row.compositionReasonCodes)}`
      : "";
    steps.push({
      step: "Composition",
      detail: `${row.semanticMode} mode, semantic ${row.semanticPolicy}${row.riskClass ? `, ${row.riskClass}-risk call` : ""} → final ${row.final}${row.narrowed ? " (narrowed)" : ""}${row.degraded ? ` (degraded: ${row.degradedReason})` : ""}${why}`,
    });
  }
  steps.push({
    step: "Capability",
    detail: row.capability
      ? `${row.capability.state}; ${row.capability.remainingUses}/${row.capability.maxUses} uses left; expires ${row.capability.expiresAt}`
      : "None issued.",
  });
  return steps;
}
