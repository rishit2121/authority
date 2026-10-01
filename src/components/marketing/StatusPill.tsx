export type StatusTone = "active" | "success" | "warning" | "denied" | "inactive";

const TONE_STYLES: Record<StatusTone, { text: string; dot: string }> = {
  active: { text: "text-mkt-indigo", dot: "bg-mkt-indigo" },
  success: { text: "text-mkt-green", dot: "bg-mkt-green" },
  warning: { text: "text-mkt-amber", dot: "bg-mkt-amber" },
  denied: { text: "text-mkt-red", dot: "bg-mkt-red" },
  inactive: { text: "text-mkt-gray", dot: "bg-mkt-gray" },
};

/**
 * A status indicator used wherever the marketing pages show an allow /
 * awaiting-approval / denied / inactive state. The label text is always the
 * primary signal — the dot is a secondary, non-essential reinforcement — so
 * the state is never conveyed by color alone.
 */
export function StatusPill({ tone, children }: { tone: StatusTone; children: string }) {
  const style = TONE_STYLES[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${style.text}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
      {children}
    </span>
  );
}
