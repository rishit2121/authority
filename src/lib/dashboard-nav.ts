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
}

export interface DashboardNavGroup {
  label: string;
  items: DashboardNavItem[];
}

/**
 * Sidebar sections for the control plane, grouped by what they're for
 * (design/frontend-simplification). Labels are chosen to explain the page
 * to a developer more directly than the underlying route name does, but no
 * route itself moves -- bookmarks, existing Playwright URL assertions, and
 * every internal link still work: `/app/runtime` is labeled "Activity" (a
 * live feed of every authorize/execute call and its receipt, across every
 * task), `/app/integrations` is labeled "Connections" (provider
 * connections, same word the developer API and docs already use), `/app/settings/applications`
 * is additionally surfaced here as a top-level "Applications" destination
 * (it still lives under Settings too -- this is additive, not a move).
 */
export const DASHBOARD_NAV_GROUPS: DashboardNavGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "Overview", href: "/app", icon: "account_tree" },
      { label: "Applications", href: "/app/settings/applications", icon: "key" },
      { label: "Tasks", href: "/app/tasks", icon: "data_object", badgeKey: "tasksActive" },
      { label: "Agents", href: "/app/agents", icon: "smart_toy" },
      { label: "Activity", href: "/app/runtime", icon: "bolt" },
      { label: "Approvals", href: "/app/approvals", icon: "mark_chat_read", badgeKey: "approvalsPending" },
    ],
  },
  {
    label: "Control",
    items: [
      { label: "Policies", href: "/app/policies", icon: "policy" },
      {
        label: "Connections",
        href: "/app/integrations",
        icon: "token",
        badgeKey: "integrationWarnings",
        badgeTone: "warning",
      },
    ],
  },
  {
    label: "Test",
    items: [{ label: "Validation Lab", href: "/app/validation", icon: "science" }],
  },
  {
    label: "System",
    items: [
      { label: "Settings", href: "/app/settings", icon: "lock" },
      { label: "Documentation", href: "/docs", icon: "description" },
    ],
  },
];

/** Flat list, for lookups that don't care about grouping. */
export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = DASHBOARD_NAV_GROUPS.flatMap((group) => group.items);

export type NavBadgeCounts = Record<NavBadgeKey, number>;
