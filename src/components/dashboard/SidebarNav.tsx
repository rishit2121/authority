"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import {
  activeNavHref,
  DASHBOARD_NAV_GROUPS,
  type DashboardNavItem,
  type NavBadgeCounts,
} from "@/lib/dashboard-nav";

interface SidebarNavProps {
  badges: NavBadgeCounts;
  isPlatformAdmin?: boolean;
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

const ADVANCED_OPEN_KEY = "authority.nav.advancedOpen";

/** Grouped control-plane navigation, shared by the desktop rail and the mobile drawer. */
export function SidebarNav({
  badges,
  isPlatformAdmin = false,
  collapsed = false,
  onNavigate,
}: SidebarNavProps) {
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    setAdvancedOpen(window.localStorage.getItem(ADVANCED_OPEN_KEY) === "1");
  }, []);

  function toggleAdvanced() {
    const next = !advancedOpen;
    setAdvancedOpen(next);
    window.localStorage.setItem(ADVANCED_OPEN_KEY, next ? "1" : "0");
  }

  return (
    <nav aria-label="Control plane" className="flex flex-col gap-space-lg">
      {DASHBOARD_NAV_GROUPS.map((group) => {
        const containsActive = group.items.some((item) => item.href === activeHref);
        const open = !group.collapsible || advancedOpen || containsActive || collapsed;
        return (
          <div key={group.label ?? "main"}>
            {group.label && !collapsed ? (
              group.collapsible ? (
                <button
                  type="button"
                  onClick={toggleAdvanced}
                  aria-expanded={open}
                  className="mb-1.5 flex w-full items-center justify-between px-space-md font-label-caps text-[10px] uppercase tracking-widest text-outline hover:text-on-surface"
                >
                  {group.label}
                  <Icon name={open ? "expand_more" : "chevron_right"} size={14} />
                </button>
              ) : (
                <div className="mb-1.5 px-space-md font-label-caps text-[10px] uppercase tracking-widest text-outline">
                  {group.label}
                </div>
              )
            ) : null}
            {open ? (
              <div className="flex flex-col gap-0.5">
                {group.items
                  .filter((item) => !item.platformAdminOnly || isPlatformAdmin)
                  .map((item) => (
                    <NavRow
                      key={item.href}
                      item={item}
                      active={item.href === activeHref}
                      collapsed={collapsed}
                      badgeCount={item.badgeKey ? badges[item.badgeKey] : 0}
                      onNavigate={onNavigate}
                    />
                  ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
