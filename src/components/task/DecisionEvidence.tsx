import { DecisionStatusBadge } from "@/components/ui/DecisionStatusBadge";
import type { AuthorizationDecision } from "@/lib/domain";

import { Panel } from "./panels";

const SOURCE_CLASSES: Record<string, string> = {
  policy: "border-deny/35 text-deny",
  contract: "border-primary/30 text-primary",
  semantic: "border-secondary/40 text-secondary",
  limit: "border-amber-400/40 text-amber-300",
};

/**
 * Why each decision came out as it did. Policy and contract reasons are
 * deterministic; semantic reasons are advisory evidence that can only narrow.
 */
export function DecisionEvidence({ decisions }: { decisions: AuthorizationDecision[] }) {
  return (
    <Panel
      id="evidence"
      title="Decision evidence"
      subtitle="Every allow, constraint and denial, with the reason that produced it"
    >
      <ul className="space-y-space-md">
        {decisions.map((decision) => (
          <li
            key={decision.id}
            className="rounded-lg border border-outline-variant/25 bg-surface-container-low p-space-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono-code text-[12px] text-on-surface">{decision.id}</span>
              <span className="flex items-center gap-2">
                <span className="font-mono-code text-[11px] text-outline">
                  {decision.latencyMs.toFixed(1)}ms
                </span>
                <DecisionStatusBadge status={decision.status} />
              </span>
            </div>
            <ul className="mt-space-sm space-y-1.5">
              {decision.reasons.map((reason) => (
                <li key={reason.code} className="flex flex-wrap items-start gap-2">
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 font-mono-code text-[10px] uppercase ${
                      SOURCE_CLASSES[reason.source] ?? "border-outline-variant/40 text-outline"
                    }`}
                  >
                    {reason.source}
                  </span>
                  <span className="font-body-sm text-body-sm text-on-surface-variant">
                    <span className="font-mono-code text-[11px] text-on-surface">{reason.code}</span> —{" "}
                    {reason.detail}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
