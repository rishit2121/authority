import type { ReactNode } from "react";

/**
 * Shared horizontal rhythm for every Phase 1 marketing section — one place
 * to keep max-width and side padding consistent instead of each section
 * re-declaring it.
 */
export function MarketingContainer({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-[1120px] px-6 md:px-10 ${className}`}>{children}</div>;
}
