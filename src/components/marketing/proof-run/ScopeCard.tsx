import type { ScopeCard as ScopeCardData } from "@/lib/proof-run/presentation";

/** The task's scope as a short definition list, derived from the recipe (see scopeCardFor). */
export function ScopeCard({
  scope,
  showRequest = false,
  className = "",
  testId = "scope-card",
}: {
  scope: ScopeCardData;
  /** Also show the user's request the scope was prepared for. */
  showRequest?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Task scope"
      className={`min-w-0 rounded-[12px] border border-line-strong bg-paper-raised p-4 sm:p-5 ${className}`}
      data-testid={testId}
    >
      <p className="font-mono-code text-[12px] uppercase tracking-[0.08em] text-ink-soft">Task scope</p>
      {showRequest ? (
        <p className="mt-2 text-[15px] leading-[1.5] text-ink">&ldquo;{scope.request}&rdquo;</p>
      ) : null}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px] leading-[1.45]">
        {scope.rows.map((row) => (
          <div key={`${row.label}-${row.value}`} className="contents">
            <dt className="text-ink-soft">{row.label}</dt>
            <dd className="min-w-0 break-words text-ink">
              {row.code ? <code className="font-mono-code text-[13px]">{row.value}</code> : row.value}
              {row.qualifier ? <span className="text-ink-soft"> ({row.qualifier})</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
