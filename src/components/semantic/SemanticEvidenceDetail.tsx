import type { SemanticEvidenceView } from "@/lib/semantic/read-model";

const SIGNAL_LABELS: [keyof NonNullable<SemanticEvidenceView["signals"]>, string, "good" | "risk"][] = [
  ["taskAlignment", "Task alignment", "good"],
  ["resourceRelevance", "Resource relevance", "good"],
  ["scopeExpansion", "Scope expansion", "risk"],
  ["externalDisclosure", "External disclosure", "risk"],
  ["promptInjection", "Prompt injection", "risk"],
  ["suspiciousArgumentChange", "Suspicious argument change", "risk"],
  ["planDeviation", "Plan deviation", "risk"],
];

const DISAGREEMENT_LABEL: Record<string, string> = {
  none: "No disagreement with the deterministic decision",
  semantic_flags_permitted: "Semantic model flagged a request the deterministic engine permitted",
  semantic_clears_denied:
    "Semantic model saw low risk in a request the deterministic engine refused (informational — a deny always stands)",
};

export function SemanticEvidenceDetail({ evidence }: { evidence: SemanticEvidenceView }) {
  return (
    <details className="group">
      <summary className="cursor-pointer font-label-sm text-label-sm text-on-surface-variant underline-offset-2 hover:underline">
        Semantic details
      </summary>
      <div className="mt-2 flex max-w-md flex-col gap-2 rounded-lg border border-outline-variant/30 bg-surface p-space-md">
        <p className="font-body-sm text-body-sm text-outline">
          Non-authoritative shadow observation. It is unattested: it records what the gateway reported, not
          proof a model ran.
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono-code text-[11px] text-on-surface-variant">
          <dt>Provider</dt>
          <dd>{evidence.provider}</dd>
          <dt>Model</dt>
          <dd>
            {evidence.model} · {evidence.modelVersion}
          </dd>
          <dt>State</dt>
          <dd>
            {evidence.state}
            {evidence.errorCategory ? ` (${evidence.errorCategory})` : ""}
          </dd>
          <dt>Confidence</dt>
          <dd>{evidence.confidence.toFixed(2)}</dd>
          <dt>Latency</dt>
          <dd>{evidence.latencyMs} ms</dd>
        </dl>
        {evidence.signals ? (
          <table className="w-full border-collapse text-left font-mono-code text-[11px]">
            <caption className="sr-only">Semantic risk signals</caption>
            <tbody>
              {SIGNAL_LABELS.map(([key, label, dir]) => (
                <tr key={key} className="border-b border-outline-variant/20 last:border-b-0">
                  <th scope="row" className="py-0.5 pr-2 font-normal text-on-surface-variant">
                    {label}
                    <span className="ml-1 text-outline">
                      ({dir === "good" ? "higher = consistent" : "higher = riskier"})
                    </span>
                  </th>
                  <td className="py-0.5 text-right text-on-surface">{evidence.signals![key].toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="font-body-sm text-body-sm text-outline">
            No signals: the evaluation did not complete.
          </p>
        )}
        {evidence.indicators.length > 0 ? (
          <p className="font-mono-code text-[11px] text-on-surface-variant">
            Indicators: {evidence.indicators.join(", ")}
          </p>
        ) : null}
        {Object.keys(evidence.redactionCounts).length > 0 ? (
          <p className="font-mono-code text-[11px] text-outline">
            Redacted before evaluation:{" "}
            {Object.entries(evidence.redactionCounts)
              .map(([k, n]) => `${k}×${n}`)
              .join(", ")}
          </p>
        ) : null}
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          {DISAGREEMENT_LABEL[evidence.disagreement] ?? evidence.disagreement}
        </p>
      </div>
    </details>
  );
}
