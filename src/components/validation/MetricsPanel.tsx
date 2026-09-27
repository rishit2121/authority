import type { CampaignMetrics, Rate } from "@/lib/validation/metrics";

import { SyntheticBadge } from "./Pill";

function pct(r: Rate): string {
  return r.value === null ? "n/a" : `${(r.value * 100).toFixed(1)}%`;
}
function ci(r: Rate): string {
  return r.value === null
    ? "no samples"
    : `${r.numerator}/${r.denominator} · 95% CI ${((r.low ?? 0) * 100).toFixed(0)}–${((r.high ?? 0) * 100).toFixed(0)}%`;
}

function Row({ label, value, detail, bad }: { label: string; value: string; detail: string; bad?: boolean }) {
  return (
    <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-space-md">
      <div className="font-body-sm text-body-sm text-on-surface-variant">{label}</div>
      <div className={`font-mono-code text-[20px] ${bad ? "text-deny" : "text-on-surface"}`}>{value}</div>
      <div className="font-mono-code text-[11px] text-outline">{detail}</div>
    </div>
  );
}

/** Every number shows its numerator, denominator and interval; there is deliberately no single composite score. */
export function MetricsPanel({ metrics }: { metrics: CampaignMetrics }) {
  const m = metrics;
  return (
    <section aria-label="Measurements" className="flex flex-col gap-space-md">
      <div className="flex items-center gap-2">
        <h3 className="font-headline-sm text-headline-sm text-on-surface">Measurements</h3>
        <SyntheticBadge />
      </div>
      <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-3">
        <Row
          label="Attack containment"
          value={pct(m.attackContainmentRate)}
          detail={ci(m.attackContainmentRate)}
        />
        <Row
          label="Unauthorized-operation block rate"
          value={pct(m.unauthorizedOperationBlockRate)}
          detail={ci(m.unauthorizedOperationBlockRate)}
        />
        <Row
          label="False negatives (attacks allowed)"
          value={pct(m.falseNegativeRate)}
          detail={ci(m.falseNegativeRate)}
          bad={m.falseNegativeRate.numerator > 0}
        />
        <Row
          label="False positives (benign blocked)"
          value={pct(m.falsePositiveRate)}
          detail={ci(m.falsePositiveRate)}
          bad={m.falsePositiveRate.numerator > 0}
        />
        <Row
          label="Least-privilege exposure (unused authority)"
          value={pct(m.leastPrivilegeExposure)}
          detail={ci(m.leastPrivilegeExposure)}
        />
        <Row
          label="Residual blast radius"
          value={`${m.residualBlastRadius.unauthorizedEffects} unauthorized effect(s)`}
          detail={
            m.residualBlastRadius.scenariosWithEffects.length
              ? m.residualBlastRadius.scenariosWithEffects.join(", ")
              : "no side effects outside the boundary"
          }
          bad={m.residualBlastRadius.unauthorizedEffects > 0}
        />
        <Row
          label="Deterministic / semantic disagreement"
          value={pct(m.deterministicSemanticDisagreement)}
          detail={ci(m.deterministicSemanticDisagreement)}
        />
        <Row
          label="Capability replay resistance"
          value={pct(m.capabilityReplayResistance)}
          detail={ci(m.capabilityReplayResistance)}
        />
        <Row
          label="Approval-bypass resistance"
          value={pct(m.approvalBypassResistance)}
          detail={ci(m.approvalBypassResistance)}
        />
        <Row
          label="Decision latency (p50 / p95)"
          value={`${m.decisionLatencyMs.p50 ?? "—"} / ${m.decisionLatencyMs.p95 ?? "—"} ms`}
          detail={`${m.decisionLatencyMs.samples} samples`}
        />
        <Row
          label="Time to first detection (median)"
          value={m.timeToDetectionMs.median === null ? "n/a" : `${m.timeToDetectionMs.median} ms`}
          detail={`${m.timeToDetectionMs.samples} samples`}
        />
        <Row
          label="Control coverage"
          value={`${m.controlCoverage.controlsExercised.length} of ${m.controlCoverage.controlsAvailable} controls`}
          detail={`${m.controlCoverage.scenarioCategories} attack categories`}
        />
        <Row
          label="Regression status"
          value={`${m.regression.passing}/${m.regression.total} passing`}
          detail={m.regression.failing ? `${m.regression.failing} failing` : "no failing regression"}
          bad={m.regression.failing > 0}
        />
      </div>
      <details className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-space-md">
        <summary className="cursor-pointer font-body-sm text-body-sm text-on-surface-variant">
          Limitations of these numbers
        </summary>
        <ul className="mt-2 list-disc pl-5 font-body-sm text-body-sm text-on-surface-variant">
          {m.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
