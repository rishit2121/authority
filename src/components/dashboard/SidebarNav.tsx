"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { DASHBOARD_NAV_GROUPS, type DashboardNavItem, type NavBadgeCounts } from "@/lib/dashboard-nav";

interface SidebarNavProps {
  badges: NavBadgeCounts;
  /** Icons-only rail; each row gets a hover/focus tooltip instead of a label. */
  collapsed?: boolean;
  onNavigate?: () => void;
}

function NavBadge({ count, tone }: { count: number; tone: "neutral" | "warning" }) {
  if (count <= 0) return null;

  return (
    <span
      className={`ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 font-mono-code text-[10px] font-semibold ${
        tone === "warning"
          ? "bg-amber-400/15 text-amber-300"
          : "bg-surface-container-highest text-on-surface-variant"
      }`}
    >
      {count}
    </span>
  );
}

function NavRow({
  item,
  active,
  collapsed,
  badgeCount,
  onNavigate,
}: {
  item: DashboardNavItem;
  active: boolean;
  collapsed: boolean;
  badgeCount: number;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={`group relative flex h-10 items-center gap-3 overflow-hidden rounded-lg border font-body-md text-body-md transition-colors ${
        collapsed ? "justify-center px-0" : "px-space-md"
      } ${
        active
          ? "border-transparent bg-signal-soft text-ink"
          : "border-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
      }`}
    >
      {active ? (
        <span className="absolute inset-y-2 left-0 w-[2px] rounded-r-full bg-signal" aria-hidden="true" />
      ) : null}
      <Icon name={item.icon} size={17} className={active ? "text-signal" : ""} />
      {!collapsed ? (
        <>
          <span className="truncate">{item.label}</span>
          {item.badgeKey ? <NavBadge count={badgeCount} tone={item.badgeTone ?? "neutral"} /> : null}
        </>
      ) : null}

      {collapsed ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-outline-variant/40 bg-surface-container-highest px-2.5 py-1.5 font-body-sm text-[12px] text-on-surface opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {item.label}
          {item.badgeKey && badgeCount > 0 ? ` · ${badgeCount}` : ""}
        </span>
      ) : null}
    </Link>
  );
}

/** Grouped control-plane navigation, shared by the desktop rail and the mobile drawer. */
export function SidebarNav({ badges, collapsed = false, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Control plane" className="flex flex-col gap-space-lg">
      {DASHBOARD_NAV_GROUPS.map((group) => (
        <div key={group.label}>
          {!collapsed ? (
            <div className="mb-1.5 px-space-md font-label-caps text-[10px] uppercase tracking-widest text-outline">
              {group.label}
            </div>
          ) : null}
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              // `/app` would otherwise match every child route.
              const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
              return (
                <NavRow
                  key={item.href}
                  item={item}
                  active={active}
                  collapsed={collapsed}
                  badgeCount={item.badgeKey ? badges[item.badgeKey] : 0}
                  onNavigate={onNavigate}
                />
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
