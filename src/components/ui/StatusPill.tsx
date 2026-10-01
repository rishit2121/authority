export type StatusTone = "positive" | "attention" | "negative" | "neutral" | "executing" | "muted";

const TONE_CLASSES: Record<StatusTone, string> = {
  positive: "border-allow/30 bg-allow/10 text-allow",
  attention: "border-secondary/40 bg-secondary/10 text-secondary",
  negative: "border-deny/30 bg-deny/10 text-deny",
  neutral: "border-line-strong bg-surface-container-high text-ink-soft",
  executing: "border-primary-container/40 bg-primary-container/10 text-primary-container",
  muted: "border-line text-ink-soft/70",
};

/**
 * One consistent status-pill system for task/contract/agent/policy/credential
 * states across the app (distinct from `DecisionStatusBadge`, which is
 * specifically for the 6-value authorization `DecisionStatus` enum). Callers
 * map their own status string to one of the tones below; text is always
 * shown — color is never the only signal.
 *
 * Suggested mapping: Active/Allowed/Completed -> positive. Awaiting
 * approval/Pending -> attention. Denied/Failed/Revoked -> negative.
 * Draft/Proposed/Shadow -> neutral. Executing -> executing.
 * Expired/Superseded -> muted.
 */
export function StatusPill({ tone, children }: { tone: StatusTone; children: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[12px] font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
