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
    accent === "cyan"
      ? "border-primary/30"
      : accent === "rose"
        ? "border-deny/35"
        : "border-outline-variant/30";

  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-heading` : undefined}
      className={`rounded-xl border ${border} bg-surface-container`}
    >
      <header className="border-b border-outline-variant/25 px-space-lg py-space-md">
        <h2
          id={id ? `${id}-heading` : undefined}
          className="font-headline-sm text-headline-sm font-semibold text-on-surface"
        >
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">{subtitle}</p>
        ) : null}
      </header>
      <div className="p-space-lg">{children}</div>
    </section>
  );
}

/** Label/value pair used across the identity panels. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-label-caps text-label-caps uppercase tracking-widest text-outline">{label}</dt>
      <dd className="mt-1 font-mono-code text-[12px] text-on-surface">{children}</dd>
    </div>
  );
}
