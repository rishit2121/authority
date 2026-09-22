import type { ReactNode } from "react";

import { Icon, type IconName } from "./Icon";

interface CodeWindowProps {
  /** Left-hand filename in the title bar. */
  filename: string;
  /** Right-hand meta label, e.g. a language or spec version. */
  meta?: string;
  icon?: IconName;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function CodeWindow({
  filename,
  meta,
  icon,
  children,
  className = "",
  bodyClassName = "bg-code-surface-deep p-space-xl",
}: CodeWindowProps) {
  return (
    <div className={`overflow-hidden rounded-xl border border-outline-variant/30 ${className}`}>
      <div className="flex items-center justify-between border-b border-outline-variant/30 bg-surface-container-low px-space-md py-space-sm font-mono-code text-[11px] text-outline">
        <span className="flex items-center gap-2 font-medium text-on-surface">
          {icon ? <Icon name={icon} size={15} className="text-primary" /> : null}
          {filename}
        </span>
        {meta ? <span>{meta}</span> : null}
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}
