import type { ReactNode } from "react";

/** Shared panel chrome for the investigation view. */
export function Panel({
  title,
  subtitle,
  children,
  id,
  accent = "neutral",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  id?: string;
  accent?: "neutral" | "cyan" | "rose";
}) {
  const border =
    accent === "cyan" ? "border-signal/30" : accent === "rose" ? "border-deny/35" : "border-line";

  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-heading` : undefined}
      className={`rounded-[10px] border ${border} bg-paper-raised`}
    >
      <header className="border-b border-line px-space-lg py-space-md">
        <h2 id={id ? `${id}-heading` : undefined} className="text-[15px] font-semibold text-ink">
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-[13px] text-ink-soft">{subtitle}</p> : null}
      </header>
      <div className="p-space-lg">{children}</div>
    </section>
  );
}

/** Label/value pair used across the identity panels. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="mt-1 font-mono-code text-[12px] text-ink">{children}</dd>
    </div>
  );
}
