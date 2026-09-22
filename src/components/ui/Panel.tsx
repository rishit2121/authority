import type { ReactNode } from "react";

interface PanelProps {
  children: ReactNode;
  /** `true` adds the hover border lift used by the card grids. */
  interactive?: boolean;
  className?: string;
}

export function Panel({ children, interactive = false, className = "" }: PanelProps) {
  return (
    <div
      className={`rounded-xl border border-outline-variant/30 bg-surface-container p-space-xl ${
        interactive ? "transition-colors hover:border-outline-variant/70" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
