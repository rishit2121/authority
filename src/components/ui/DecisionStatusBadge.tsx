import { presentDecisionStatus, type DecisionTone } from "@/lib/authorization";
import type { DecisionStatus } from "@/lib/domain";

/**
 * Renders one of the six authorization decision statuses.
 *
 * Tone-to-class mapping lives here so the semantic vocabulary in
 * `decision-status.ts` stays free of Tailwind specifics.
 */
const TONE_CLASSES: Record<DecisionTone, string> = {
  positive: "border-allow/30 bg-allow/10 text-allow",
  constrained: "border-primary/30 bg-primary/10 text-primary",
  attention: "border-secondary/40 bg-secondary/10 text-secondary",
  neutral: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
  negative: "border-error/30 bg-error/10 text-error",
};

interface DecisionStatusBadgeProps {
  status: DecisionStatus;
  /** Show the uppercase token instead of the human label. */
  mono?: boolean;
  className?: string;
}

export function DecisionStatusBadge({ status, mono = false, className = "" }: DecisionStatusBadgeProps) {
  const presentation = presentDecisionStatus(status);

  return (
    <span
      data-status={status}
      data-tone={presentation.tone}
      title={presentation.description}
      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono-code text-[11px] ${
        TONE_CLASSES[presentation.tone]
      } ${className}`}
    >
      {mono ? presentation.token : presentation.label}
    </span>
  );
}
