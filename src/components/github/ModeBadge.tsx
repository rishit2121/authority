/** Distinguishes simulated (mock) execution from live GitHub execution everywhere it is shown. */
export function ModeBadge({ mode }: { mode: "mock" | "live" | "disabled" }) {
  const cls =
    mode === "live"
      ? "border-allow/40 bg-allow/10 text-allow"
      : mode === "mock"
        ? "border-secondary/40 bg-secondary/10 text-secondary"
        : "border-outline-variant/40 bg-surface-container-high text-on-surface-variant";
  const label =
    mode === "live" ? "LIVE GitHub" : mode === "mock" ? "MOCK (simulated GitHub)" : "Connector disabled";
  return (
    <span
      data-testid={`mode-badge-${mode}`}
      className={`inline-flex rounded border px-2 py-0.5 font-mono-code text-[11px] ${cls}`}
    >
      {label}
    </span>
  );
}
