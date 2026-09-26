import { semanticSignalsSchema, type SemanticSignals } from "@/lib/domain";

import { percentile } from "./stats";

/** A persisted shadow evaluation shaped for display. Nothing here is authoritative. */
export interface SemanticEvidenceView {
  id: string;
  decisionId: string;
  taskId: string;
  provider: string;
  model: string;
  modelVersion: string;
  state: string;
  riskLevel: string;
  signals: SemanticSignals | null;
  indicators: string[];
  confidence: number;
  latencyMs: number;
  disagreement: string;
  errorCategory: string | null;
  redactionCounts: Record<string, number>;
  createdAt: string;
}

interface EvidenceRow {
  id: string;
  authorization_decision_id: string;
  task_id: string;
  provider: string;
  model: string;
  model_version: string;
  state: string;
  risk_level: string;
  signals: unknown;
  indicators: string[];
  confidence: number;
  latency_ms: number;
  disagreement?: string;
  error_category: string | null;
  redaction_summary: unknown;
  created_at: string;
}

export const EVIDENCE_COLUMNS =
  "id, authorization_decision_id, task_id, provider, model, model_version, state, risk_level, signals, indicators, confidence, latency_ms, disagreement, error_category, redaction_summary, created_at";

/** semantic_evaluations (Part 6) carries no stored disagreement: it is derived from the two decisions. */
export const GATEWAY_EVIDENCE_COLUMNS =
  "id, authorization_decision_id, task_id, provider, model, model_version, state, risk_level, signals, indicators, confidence, latency_ms, error_category, redaction_summary, created_at";

export function toEvidenceView(row: EvidenceRow): SemanticEvidenceView {
  let signals: SemanticSignals | null = null;
  if (row.signals && typeof row.signals === "object") {
    const { schemaVersion: _v, ...rest } = row.signals as Record<string, unknown>;
    void _v;
    const parsed = semanticSignalsSchema.safeParse(rest);
    signals = parsed.success ? parsed.data : null;
  }
  const counts = (row.redaction_summary as { counts?: Record<string, number> } | null)?.counts ?? {};
  return {
    id: row.id,
    decisionId: row.authorization_decision_id,
    taskId: row.task_id,
    provider: row.provider,
    model: row.model,
    modelVersion: row.model_version,
    state: row.state,
    riskLevel: row.risk_level,
    signals,
    indicators: row.indicators ?? [],
    confidence: row.confidence,
    latencyMs: row.latency_ms,
    disagreement: row.disagreement ?? "none",
    errorCategory: row.error_category,
    redactionCounts: counts,
    createdAt: row.created_at,
  };
}

export interface ProviderHealth {
  provider: string;
  total: number;
  ok: number;
  timeout: number;
  error: number;
  unavailable: number;
  circuitOpen: number;
  timeoutRate: number;
  failureRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  lastSeen: string;
}

/** Durable provider health, computed from persisted evidence (in-memory breaker state is per-process and not shown here). */
export function summarizeHealth(rows: SemanticEvidenceView[]): ProviderHealth[] {
  const groups = new Map<string, SemanticEvidenceView[]>();
  for (const row of rows) {
    const key = `${row.provider}/${row.model}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([provider, items]) => {
      const count = (s: string) => items.filter((i) => i.state === s).length;
      const okLatencies = items
        .filter((i) => i.state === "ok")
        .map((i) => i.latencyMs)
        .sort((a, b) => a - b);
      const failures = items.length - count("ok");
      return {
        provider,
        total: items.length,
        ok: count("ok"),
        timeout: count("timeout"),
        error: count("error"),
        unavailable: count("unavailable"),
        circuitOpen: count("circuit_open"),
        timeoutRate: items.length ? count("timeout") / items.length : 0,
        failureRate: items.length ? failures / items.length : 0,
        p50LatencyMs: percentile(okLatencies, 50),
        p95LatencyMs: percentile(okLatencies, 95),
        lastSeen:
          items
            .map((i) => i.createdAt)
            .sort()
            .at(-1) ?? "",
      };
    })
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

export const RISK_ORDER = ["critical", "high", "medium", "low", "unknown"] as const;
