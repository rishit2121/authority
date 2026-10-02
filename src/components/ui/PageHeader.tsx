import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The consistent page-header pattern used across /app/**: an optional small
 * eyebrow/breadcrumb, a title, one short explanatory sentence, and a primary
 * action on the right with an optional secondary action beside it. Keeps
 * routine pages from opening with a long paragraph.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  primaryAction?: { label: string; href: string };
  secondaryAction?: { label: string; href: string };
  /** For the rare case an action needs to be a form button, not a link. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1.5">
        {eyebrow ? (
          <span className="text-[12px] font-medium uppercase tracking-wide text-ink-soft">{eyebrow}</span>
        ) : null}
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="max-w-xl text-[14px] text-ink-soft">{description}</p> : null}
      </div>
      {primaryAction || secondaryAction || children ? (
        <div className="flex shrink-0 items-center gap-3">
          {secondaryAction ? (
            <Link
              href={secondaryAction.href}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-line-strong px-4 text-[14px] font-medium text-ink transition-colors hover:bg-black/[0.03]"
            >
              {secondaryAction.label}
            </Link>
          ) : null}
          {primaryAction ? (
            <Link
              href={primaryAction.href}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-[14px] font-medium text-on-primary transition-colors hover:bg-primary-fixed"
            >
              {primaryAction.label}
            </Link>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
