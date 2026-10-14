"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Icon } from "@/components/ui/Icon";
import { switchWorkspaceAction } from "@/lib/auth/actions";
import { TENANT_ROLE_LABELS, type TenantMembership } from "@/lib/auth/tenant-context";

/**
 * Workspace switcher over the user's real tenant memberships.
 *
 * Selecting an entry calls a server action, which re-verifies membership
 * against the database before persisting anything. This component only
 * displays what the server already resolved — it holds no authority of its
 * own, and hiding an entry here is presentation, not enforcement.
 */
export function WorkspaceSelector({
  memberships,
  currentTenantId,
  collapsed = false,
  demoDataEnabled = false,
}: {
  memberships: TenantMembership[];
  currentTenantId: string;
  collapsed?: boolean;
  /** Label development workspaces as holding sample data -- only on deployments that offer sample data at all. */
  demoDataEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const active = memberships.find((m) => m.tenantId === currentTenantId) ?? memberships[0];

  if (!active) return null;

  const select = (tenantId: string) => {
    setOpen(false);
    if (tenantId === currentTenantId) return;

    startTransition(async () => {
      const result = await switchWorkspaceAction(tenantId);
      if (!result.ok) {
        setError(result.error ?? "Could not switch workspace.");
        return;
      }

      setError(null);
      // Always land on the destination tenant's dashboard root rather than
      // re-rendering whatever page was open. A task URL is tenant-specific
      // (it becomes inaccessible under the new tenant's RLS scope anyway,
      // but redirecting is the honest behaviour rather than letting the
      // current page flash a 404 for a task that still exists — just not
      // here).
      router.push("/app");
    });
  };

  if (collapsed) {
    return (
      <div
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container font-mono-code text-[11px] font-semibold text-on-surface"
        title={active.name}
        aria-label={`Workspace: ${active.name}`}
      >
        {active.name.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-outline-variant/30 bg-surface-container px-space-md py-2 text-left transition-colors hover:border-outline-variant/60 disabled:opacity-60"
      >
        <span className="min-w-0">
          <span className="block truncate font-body-md text-body-md font-medium text-on-surface">
            {active.name}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 truncate font-body-sm text-[11px] text-on-surface-variant">
            {TENANT_ROLE_LABELS[active.role]}
            {demoDataEnabled && active.environment === "development" ? (
              <span className="rounded border border-line-strong px-1 py-px text-[10px] font-medium text-ink-soft">
                Demo data
              </span>
            ) : null}
          </span>
        </span>
        <Icon
          name="expand_more"
          size={16}
          className={`shrink-0 text-outline transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Switch workspace"
          className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container-highest shadow-xl"
        >
          {memberships.map((membership) => (
            <button
              key={membership.tenantId}
              type="button"
              role="menuitemradio"
              aria-checked={membership.tenantId === currentTenantId}
              onClick={() => select(membership.tenantId)}
              className={`flex w-full items-center justify-between gap-2 px-space-md py-2.5 text-left font-body-sm text-[13px] transition-colors hover:bg-surface-container-high ${
                membership.tenantId === currentTenantId ? "text-primary" : "text-on-surface"
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate">{membership.name}</span>
                <span className="block truncate font-mono-token text-[10px] uppercase tracking-wider text-outline">
                  {TENANT_ROLE_LABELS[membership.role]}
                </span>
              </span>
              {membership.tenantId === currentTenantId ? <Icon name="check_circle" size={14} /> : null}
            </button>
          ))}

          {memberships.length === 1 ? (
            <div className="border-t border-outline-variant/30 px-space-md py-2.5 font-body-sm text-[12px] text-outline">
              You belong to one workspace. Team invitations arrive in a later release.
            </div>
          ) : null}
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {pending ? "Switching workspace" : ""}
      </p>

      {error ? (
        <p role="alert" className="mt-space-xs font-body-sm text-[11px] text-deny">
          {error}
        </p>
      ) : null}
    </div>
  );
}
