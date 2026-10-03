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
 * (design/frontend-simplification). The visible label for `/app/runtime` is
 * "Tool calls" — it explains the page to a developer more directly than
 * "Runtime" does — but the route itself is unchanged, so bookmarks, the
 * existing Playwright coverage's URL assertions, and every internal link
 * still work.
 */
export const DASHBOARD_NAV_GROUPS: DashboardNavGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "Overview", href: "/app", icon: "account_tree" },
      { label: "Tasks", href: "/app/tasks", icon: "data_object", badgeKey: "tasksActive" },
      { label: "Agents", href: "/app/agents", icon: "smart_toy" },
      { label: "Tool calls", href: "/app/runtime", icon: "bolt" },
      { label: "Approvals", href: "/app/approvals", icon: "mark_chat_read", badgeKey: "approvalsPending" },
    ],
  },
  {
    label: "Control",
    items: [
      { label: "Policies", href: "/app/policies", icon: "policy" },
      {
        label: "Integrations",
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
      { label: "Docs", href: "/docs", icon: "description" },
    ],
  },
];

/** Flat list, for lookups that don't care about grouping. */
export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = DASHBOARD_NAV_GROUPS.flatMap((group) => group.items);

export type NavBadgeCounts = Record<NavBadgeKey, number>;
