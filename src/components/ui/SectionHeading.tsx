import type { ReactNode } from "react";

type HeadingSize = "sm" | "md" | "lg";

const TITLE_SIZE: Record<HeadingSize, string> = {
  sm: "text-[2rem] md:text-[2.5rem]",
  md: "text-[2rem] md:text-[2.75rem]",
  lg: "text-[2.25rem] md:text-[3rem]",
};

interface SectionHeadingProps {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  size?: HeadingSize;
  /** Width + bottom-spacing utilities, which differ per section in the design. */
  className?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  size = "md",
  className = "max-w-2xl mb-space-2xl",
}: SectionHeadingProps) {
  const centered = align === "center";

  return (
    <div className={`${centered ? "mx-auto text-center" : ""} ${className}`}>
      <span className="font-label-caps text-label-caps uppercase tracking-widest text-primary">
        {eyebrow}
      </span>
      <h2
        className={`mt-space-sm font-headline-lg ${TITLE_SIZE[size]} font-semibold leading-[1.18] tracking-tight text-on-surface`}
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-space-sm font-body-lg text-body-lg text-on-surface-variant">{description}</p>
      ) : null}
    </div>
  );
}
