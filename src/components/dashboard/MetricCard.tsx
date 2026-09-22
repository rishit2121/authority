import type { OverviewMetric } from "@/lib/data/dashboard";

/** Tone → accent, matching the product palette used across the app. */
const TONE_CLASSES: Record<OverviewMetric["tone"], string> = {
  cyan: "text-primary-container",
  violet: "text-secondary",
  green: "text-allow",
  amber: "text-amber-300",
  rose: "text-deny",
  neutral: "text-on-surface",
};

export function MetricCard({ metric }: { metric: OverviewMetric }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-md">
      <div className="font-label-caps text-label-caps uppercase tracking-widest text-outline">
        {metric.label}
      </div>
      <div
        className={`mt-1.5 font-headline-lg text-[1.75rem] font-semibold leading-none ${TONE_CLASSES[metric.tone]}`}
      >
        {metric.value}
      </div>
      <div className="mt-1.5 font-mono-code text-[11px] text-on-surface-variant">{metric.caption}</div>
    </div>
  );
}
