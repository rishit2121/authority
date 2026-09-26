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

/** Sidebar sections for the control plane, grouped by what they're for. */
export const DASHBOARD_NAV_GROUPS: DashboardNavGroup[] = [
  {
    label: "Monitor",
    items: [
      { label: "Overview", href: "/app", icon: "account_tree" },
      { label: "Tasks", href: "/app/tasks", icon: "data_object", badgeKey: "tasksActive" },
      { label: "Agents", href: "/app/agents", icon: "smart_toy" },
      { label: "Runtime", href: "/app/runtime", icon: "bolt" },
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
      { label: "Approvals", href: "/app/approvals", icon: "mark_chat_read", badgeKey: "approvalsPending" },
    ],
  },
  {
    label: "System",
    items: [{ label: "Settings", href: "/app/settings", icon: "lock" }],
  },
];

/** Flat list, for lookups that don't care about grouping. */
export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = DASHBOARD_NAV_GROUPS.flatMap((group) => group.items);

export type NavBadgeCounts = Record<NavBadgeKey, number>;
