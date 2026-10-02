import Link from "next/link";
import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";

export interface EmptyStateAction {
  label: string;
  href: string;
}

/**
 * One shared, page-specific empty state: an icon, one heading, one sentence,
 * and at most one primary action. Replaces the old pattern of reusing
 * `EmptyWorkspace`'s "No agents or tasks have been configured" message on
 * pages where that was often simply inaccurate (e.g. an empty Policies page
 * on a workspace that already has agents and tasks).
 */
export function EmptyState({
  icon = "data_object",
  heading,
  description,
  action,
  children,
}: {
  icon?: IconName;
  heading: string;
  description: string;
  action?: EmptyStateAction;
  /** For the rare case a second, non-link action (e.g. a form button) is needed. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[10px] border border-line bg-paper-raised px-6 py-14 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-container-high text-ink-soft">
        <Icon name={icon} size={18} />
      </span>
      <div className="flex max-w-sm flex-col gap-1.5">
        <h2 className="text-[17px] font-semibold text-ink">{heading}</h2>
        <p className="text-[14px] leading-relaxed text-ink-soft">{description}</p>
      </div>
      {action ? (
        <Link
          href={action.href}
          className="mt-1 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-[14px] font-medium text-on-primary transition-colors hover:bg-primary-fixed"
        >
          {action.label}
        </Link>
      ) : null}
      {children}
    </div>
  );
}
