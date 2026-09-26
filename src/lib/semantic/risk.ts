import type { SemanticDisagreement, SemanticRiskLevel, SemanticSignals } from "@/lib/domain";

/** Thresholds are conservative defaults, exported so the evaluation report can state them. */
export const RISK_THRESHOLDS = { medium: 0.3, high: 0.55, critical: 0.8 } as const;
/** Below this confidence, a high score is reported one level lower — never higher. */
export const MIN_CONFIDENCE_FOR_FULL_LEVEL = 0.35;

/** Aggregate risk score in [0, 1] from the individual signals. Pure and monotone. */
export function aggregateRisk(signals: SemanticSignals): number {
  const contributions = [
    signals.promptInjection,
    signals.externalDisclosure,
    signals.scopeExpansion * 0.9,
    signals.suspiciousArgumentChange,
    signals.planDeviation * 0.8,
    // Misalignment only matters when it is pronounced.
    Math.max(0, (0.5 - signals.taskAlignment) * 1.4),
    Math.max(0, (0.5 - signals.resourceRelevance) * 1.2),
  ];
  return Math.min(1, Math.max(...contributions));
}

export function riskLevelFor(signals: SemanticSignals, confidence: number): SemanticRiskLevel {
  const score = aggregateRisk(signals);
  let level: SemanticRiskLevel =
    score >= RISK_THRESHOLDS.critical
      ? "critical"
      : score >= RISK_THRESHOLDS.high
        ? "high"
        : score >= RISK_THRESHOLDS.medium
          ? "medium"
          : "low";
  if (confidence < MIN_CONFIDENCE_FOR_FULL_LEVEL) {
    // A shaky opinion is downgraded, so low confidence can only ever make the
    // observation quieter — it cannot manufacture an alarm.
    level = level === "critical" ? "high" : level === "high" ? "medium" : level;
  }
  return level;
}

/** Mirrors `authz.semantic_disagreement_for()` in the database; both are held to the same cases in tests. */
export function classifyDisagreement(
  outcome: "allow" | "allow_constrained" | "replan" | "clarify" | "require_approval" | "deny",
  risk: SemanticRiskLevel,
): SemanticDisagreement {
  if ((outcome === "allow" || outcome === "allow_constrained") && (risk === "high" || risk === "critical")) {
    return "semantic_flags_permitted";
  }
  if ((outcome === "deny" || outcome === "replan") && risk === "low") return "semantic_clears_denied";
  return "none";
}
