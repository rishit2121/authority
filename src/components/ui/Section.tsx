import type { ReactNode } from "react";

type SectionVariant = "plain" | "band";

interface SectionProps {
  children: ReactNode;
  /** `band` is the full-bleed darker stripe the export alternates between. */
  variant?: SectionVariant;
  id?: string;
  className?: string;
}

const CONTAINER = "mx-auto w-full max-w-[1280px] px-margin md:px-margin-lg";

export function Section({ children, variant = "plain", id, className = "" }: SectionProps) {
  if (variant === "band") {
    return (
      <section
        id={id}
        className={`w-full border-y border-outline-variant/20 bg-band py-space-2xl md:py-[120px] ${className}`}
      >
        <div className={CONTAINER}>{children}</div>
      </section>
    );
  }

  return (
    <section id={id} className={`${CONTAINER} py-space-2xl md:py-[120px] ${className}`}>
      {children}
    </section>
  );
}
