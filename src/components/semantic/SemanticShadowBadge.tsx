import type { SemanticEvidenceView } from "@/lib/semantic/read-model";

const RISK_CLASSES: Record<string, string> = {
  critical: "border-deny/50 bg-deny/15 text-deny",
  high: "border-deny/40 bg-deny/10 text-deny",
  medium: "border-secondary/40 bg-secondary/10 text-secondary",
  low: "border-allow/30 bg-allow/10 text-allow",
  unknown: "border-outline-variant/40 bg-surface-container-high text-outline",
};

const STATE_LABEL: Record<string, string> = {
  ok: "",
  timeout: "timed out",
  error: "provider error",
  unavailable: "provider unavailable",
  circuit_open: "circuit open",
};

/** Compact risk pill. Always accompanied by the shadow-only label: it never implies enforcement. */
export function SemanticShadowBadge({ evidence }: { evidence: SemanticEvidenceView | undefined }) {
  if (!evidence) {
    return <span className="font-mono-code text-[11px] text-outline">not evaluated</span>;
  }
  const degraded = STATE_LABEL[evidence.state];
  return (
    <span className="flex flex-col gap-1">
      <span
        data-testid="semantic-risk"
        className={`inline-flex w-fit rounded border px-2 py-0.5 font-mono-code text-[11px] ${RISK_CLASSES[evidence.riskLevel] ?? RISK_CLASSES.unknown}`}
      >
        {evidence.riskLevel}
        {degraded ? ` · ${degraded}` : ""}
      </span>
      <span className="font-label-sm text-[10px] uppercase tracking-wider text-outline">
        Shadow only — did not affect authorization
      </span>
    </span>
  );
}
