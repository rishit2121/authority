import { SemanticEvidenceDetail } from "./SemanticEvidenceDetail";
import { SemanticShadowBadge } from "./SemanticShadowBadge";
import type { SemanticEvidenceView } from "@/lib/semantic/read-model";

export interface SemanticPanelRow {
  decisionId: string;
  tool: string;
  outcome: string;
  requestedAt: string;
  evidence: SemanticEvidenceView | undefined;
}

/** Task-level view of shadow semantic observations, next to (never in place of) each deterministic decision. */
export function SemanticShadowPanel({ rows }: { rows: SemanticPanelRow[] }) {
  return (
    <section
      id="semantic-shadow"
      aria-labelledby="semantic-shadow-heading"
      className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
    >
      <h2
        id="semantic-shadow-heading"
        className="font-headline-sm text-headline-sm font-semibold text-on-surface"
      >
        Semantic risk (shadow)
      </h2>
      <p className="mt-space-sm max-w-2xl font-body-sm text-body-sm text-on-surface-variant">
        Shadow only — these observations did not affect any authorization decision below. They are unattested
        and cannot grant, widen or restore anything.
      </p>
      {rows.length === 0 ? (
        <p className="mt-space-md font-body-sm text-body-sm text-outline">
          No runtime calls have been made for this task yet.
        </p>
      ) : (
        <ul className="mt-space-md flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.decisionId}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-outline-variant/20 bg-surface p-space-md"
            >
              <div className="flex flex-col gap-1">
                <span className="font-mono-code text-[12px] text-on-surface">{row.tool}</span>
                <span className="font-mono-code text-[11px] text-outline">
                  deterministic: {row.outcome} · {new Date(row.requestedAt).toLocaleString()}
                </span>
                {row.evidence && row.evidence.disagreement !== "none" ? (
                  <span className="font-mono-code text-[11px] text-secondary">
                    ⚠ disagrees with the deterministic decision
                  </span>
                ) : null}
              </div>
              <div className="flex flex-col items-end gap-2">
                <SemanticShadowBadge evidence={row.evidence} />
                {row.evidence ? <SemanticEvidenceDetail evidence={row.evidence} /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
