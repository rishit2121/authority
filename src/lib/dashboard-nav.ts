import type { IconName } from "@/components/ui/Icon";

export type NavBadgeKey = "tasksActive" | "approvalsPending" | "integrationWarnings";

export interface DashboardNavItem {
  label: string;
  href: string;
  icon: IconName;
  /** Resolved at render time from `NavBadgeCounts`; omitted items show no badge. */
  badgeKey?: NavBadgeKey;
  /** Amber "needs attention" styling instead of a neutral count. */
  badgeTone?: "neutral" | "warning";
  /** Shown only to operators of this deployment (PLATFORM_ADMIN_EMAILS); the page re-checks server-side. */
  platformAdminOnly?: boolean;
}

export interface DashboardNavGroup {
  /** null = no visible heading (the main, always-shown group). */
  label: string | null;
  items: DashboardNavItem[];
  /** Hidden behind a toggle until opened, or until the current page is one of its items. */
  collapsible?: boolean;
}

/**
 * Sidebar sections. The first group is everything a typical developer
 * needs day to day; power-user and internal tooling lives under "Advanced",
 * collapsed by default. No route moves -- `/app/runtime` is labeled
 * "Activity" and `/app/integrations` "Connections", as before.
 */
export const DASHBOARD_NAV_GROUPS: DashboardNavGroup[] = [
  {
    label: null,
    items: [
      { label: "Setup", href: "/app/setup", icon: "play_arrow" },
      { label: "Overview", href: "/app", icon: "account_tree" },
      { label: "Agents", href: "/app/agents", icon: "smart_toy" },
      {
        label: "Connections",
        href: "/app/integrations",
        icon: "token",
        badgeKey: "integrationWarnings",
        badgeTone: "warning",
      },
      { label: "Activity", href: "/app/runtime", icon: "bolt" },
      { label: "Approvals", href: "/app/approvals", icon: "mark_chat_read", badgeKey: "approvalsPending" },
      { label: "Settings", href: "/app/settings", icon: "lock" },
      { label: "Docs", href: "/docs", icon: "description" },
      { label: "Metrics", href: "/app/admin", icon: "person", platformAdminOnly: true },
    ],
  },
  {
    label: "Advanced",
    collapsible: true,
    items: [
      { label: "Applications", href: "/app/settings/applications", icon: "key" },
      { label: "Tasks", href: "/app/tasks", icon: "data_object", badgeKey: "tasksActive" },
      { label: "Policies", href: "/app/policies", icon: "policy" },
      { label: "Validation Lab", href: "/app/validation", icon: "science" },
    ],
  },
];

/** Flat list, for lookups that don't care about grouping. */
export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = DASHBOARD_NAV_GROUPS.flatMap((group) => group.items);

function matches(href: string, pathname: string): boolean {
  // `/app` would otherwise match every child route.
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The single nav item for this path: the longest matching href, so /app/settings/applications isn't also "Settings". */
export function activeNavHref(pathname: string): string | null {
  let best: string | null = null;
  for (const item of DASHBOARD_NAV_ITEMS) {
    if (matches(item.href, pathname) && (!best || item.href.length > best.length)) best = item.href;
  }
  return best;
}

export type NavBadgeCounts = Record<NavBadgeKey, number>;
