"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Logo } from "@/components/marketing/Logo";
import { Icon } from "@/components/ui/Icon";
import { StatusDot } from "@/components/ui/StatusDot";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import type { TenantMembership } from "@/lib/auth/tenant-context";
import type { NavBadgeCounts } from "@/lib/dashboard-nav";

import { SidebarNav } from "./SidebarNav";
import { UserMenu, type UserMenuIdentity } from "./UserMenu";
import { WorkspaceSelector } from "./WorkspaceSelector";

/** Product identity + collapse toggle, shared by the desktop rail. */
function SidebarHeader({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
      <Link href="/" className="flex min-w-0 items-center gap-space-sm">
        <Logo size={24} />
        {!collapsed ? (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-headline-sm text-body-md font-semibold text-on-surface">
              Authority
            </span>
            <span className="truncate font-label-caps text-[10px] uppercase tracking-widest text-outline">
              Control plane
            </span>
          </span>
        ) : null}
      </Link>
      {!collapsed ? (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Collapse sidebar"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          <Icon name="chevron_left" size={16} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Gateway status + account control, pinned to the bottom of the rail.
 *
 * "Gateway online" and "Deterministic enforcement" are two separate, always-
 * true facts about this product's architecture (the gateway only renders
 * this shell once it has successfully reached the tenant's data, and the
 * deterministic layer is never toggleable off) — not a claim derived from a
 * live health check. `jevAdvisory` reflects the tenant's actual
 * `jev_settings` row, read in the layout: it never implies Jev enforces
 * anything while it's in shadow mode.
 */
function SidebarFooter({
  collapsed,
  identity,
  jevAdvisory,
}: {
  collapsed: boolean;
  identity: UserMenuIdentity;
  jevAdvisory: boolean;
}) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-space-md border-t border-line pt-space-md">
        <span
          title="Gateway online · deterministic enforcement"
          aria-label="Gateway online, deterministic enforcement"
          className="flex h-7 w-7 items-center justify-center"
        >
          <StatusDot className="bg-allow" ping={false} />
        </span>
        <UserMenu identity={identity} collapsed />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-space-sm border-t border-line pt-space-md">
      <div className="flex flex-col gap-1 rounded-lg border border-line bg-paper-raised px-space-md py-2.5 text-[12px]">
        <span className="flex items-center gap-2 text-ink">
          <StatusDot className="bg-allow" ping={false} />
          Gateway online
        </span>
        <span className="pl-[18px] text-ink-soft">Deterministic enforcement</span>
        {jevAdvisory ? <span className="pl-[18px] text-ink-soft">Jev · advisory</span> : null}
      </div>
      <UserMenu identity={identity} />
    </div>
  );
}

interface DashboardShellProps {
  children: ReactNode;
  badges: NavBadgeCounts;
  /** Whether Jev (necessity and/or risk) is on in this tenant — always advisory, never enforcing. */
  jevAdvisory: boolean;
  /** Resolved server-side by requireIdentity(); never derived in the browser. */
  identity: UserMenuIdentity;
  memberships: TenantMembership[];
  currentTenantId: string;
}

/**
 * Control-plane chrome: a collapsible sticky rail on desktop, a focus-trapped
 * drawer on small screens. Quieter than the marketing surface — hierarchy
 * over glow.
 */
export function DashboardShell({
  children,
  badges,
  jevAdvisory,
  identity,
  memberships,
  currentTenantId,
}: DashboardShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const pathname = usePathname();

  const drawerRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  // A route change is a form of dismissal: the drawer must not stay open
  // over content the user just navigated away from.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  useFocusTrap({
    active: menuOpen,
    containerRef: drawerRef,
    returnFocusRef: menuTriggerRef,
    onClose: () => setMenuOpen(false),
  });

  return (
    <div className="min-h-screen bg-surface-container-lowest">
      <a
        href="#dashboard-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
      >
        Skip to content
      </a>

      <div className="mx-auto flex w-full max-w-[1760px]">
        {/* Desktop sidebar */}
        <aside
          className={`sticky top-0 hidden h-screen shrink-0 flex-col justify-between border-r border-outline-variant/20 bg-surface-container-low transition-[width] duration-200 lg:flex ${
            collapsed ? "w-[72px] px-2.5 py-space-lg" : "w-[240px] p-space-lg"
          }`}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-space-lg overflow-y-auto">
            <SidebarHeader collapsed={collapsed} onToggleCollapsed={() => setCollapsed(true)} />

            {collapsed ? (
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                aria-label="Expand sidebar"
                className="flex h-9 items-center justify-center rounded-lg border border-outline-variant/30 text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <Icon name="chevron_right" size={16} />
              </button>
            ) : (
              <WorkspaceSelector memberships={memberships} currentTenantId={currentTenantId} />
            )}

            <SidebarNav badges={badges} collapsed={collapsed} />
          </div>

          <SidebarFooter collapsed={collapsed} identity={identity} jevAdvisory={jevAdvisory} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile bar */}
          <div className="sticky top-0 z-40 flex items-center justify-between border-b border-outline-variant/30 bg-surface-container-low/95 px-gutter py-3 backdrop-blur-md lg:hidden">
            <Link href="/" className="flex items-center gap-space-sm">
              <Logo size={22} />
              <span className="font-headline-sm text-body-md font-semibold text-on-surface">Authority</span>
            </Link>
            <button
              ref={menuTriggerRef}
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-controls="dashboard-mobile-nav"
              className="flex items-center gap-2 rounded border border-outline-variant/40 bg-surface-container px-3 py-1.5 font-body-sm text-[12px] text-on-surface"
            >
              <Icon name="menu" size={15} />
              Menu
            </button>
          </div>

          <main
            id="dashboard-main"
            // Skip links only work if their target can actually receive
            // focus; a bare id lets the browser scroll to it but never
            // focuses a non-interactive element.
            tabIndex={-1}
            className="min-w-0 flex-1 px-gutter py-space-xl outline-none md:px-space-xl"
          >
            {children}
          </main>
        </div>
      </div>

      {/* Mobile drawer */}
      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            aria-hidden="true"
            onClick={() => setMenuOpen(false)}
          />
          <div
            ref={drawerRef}
            id="dashboard-mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Control plane navigation"
            className="absolute inset-y-0 left-0 flex w-[86%] max-w-xs flex-col gap-space-lg overflow-y-auto border-r border-outline-variant/30 bg-surface-container-low p-space-lg shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <Link href="/" onClick={() => setMenuOpen(false)} className="flex items-center gap-space-sm">
                <Logo size={22} />
                <span className="font-headline-sm text-body-md font-semibold text-on-surface">Authority</span>
              </Link>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Close navigation"
                className="flex h-8 w-8 items-center justify-center rounded-md text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <Icon name="cancel" size={18} />
              </button>
            </div>

            <WorkspaceSelector memberships={memberships} currentTenantId={currentTenantId} />
            <SidebarNav badges={badges} onNavigate={() => setMenuOpen(false)} />

            <div className="mt-auto">
              <SidebarFooter collapsed={false} identity={identity} jevAdvisory={jevAdvisory} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
