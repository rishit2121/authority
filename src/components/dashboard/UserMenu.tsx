"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { resetDemoWorkspaceAction } from "@/app/app/actions";
import { Icon } from "@/components/ui/Icon";
import { TENANT_ROLE_LABELS, type TenantEnvironment, type TenantRole } from "@/lib/auth/tenant-context";

export interface UserMenuIdentity {
  displayName: string;
  email: string;
  initials: string;
  role: TenantRole;
  /** Used only to decide whether "Reset demo data" appears — the server action itself
   *  re-verifies the tenant and role regardless of what this menu renders. */
  environment: TenantEnvironment;
}

/**
 * Bottom-of-sidebar account control.
 *
 * Receives the authenticated identity as props — it no longer imports a
 * fixture. Sign-out posts to a route handler rather than calling Supabase from
 * the browser, so the session cookies are cleared server-side by the same code
 * path regardless of client state.
 */
export function UserMenu({
  identity,
  collapsed = false,
}: {
  identity: UserMenuIdentity;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const roleLabel = TENANT_ROLE_LABELS[identity.role];

  const avatar = (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary font-mono-code text-[11px] font-semibold text-on-primary">
      {identity.initials}
    </span>
  );

  if (collapsed) {
    return (
      <div
        ref={rootRef}
        className="relative flex justify-center"
        title={`${identity.displayName} · ${roleLabel}`}
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Account menu for ${identity.displayName}`}
        >
          {avatar}
        </button>
        {open ? (
          <div
            role="menu"
            aria-label="Account"
            className="absolute bottom-0 left-full z-30 ml-2 w-60 overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container-highest shadow-xl"
          >
            <MenuItems identity={identity} roleLabel={roleLabel} />
          </div>
        ) : null}
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
        className="flex w-full items-center gap-2.5 rounded-lg border border-transparent px-space-sm py-2 text-left transition-colors hover:border-outline-variant/30 hover:bg-surface-container-high"
      >
        {avatar}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-body-md text-body-md font-medium text-on-surface">
            {identity.displayName}
          </span>
          <span className="block truncate font-body-sm text-[11px] text-on-surface-variant">{roleLabel}</span>
        </span>
        <Icon
          name="expand_more"
          size={16}
          className={`text-outline transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute inset-x-0 bottom-full z-30 mb-1.5 overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container-highest shadow-xl"
        >
          <MenuItems identity={identity} roleLabel={roleLabel} />
        </div>
      ) : null}
    </div>
  );
}

function MenuItems({ identity, roleLabel }: { identity: UserMenuIdentity; roleLabel: string }) {
  // Demo-seeded tenants are development-environment ones in this codebase's own demo installer.
  // The server action re-verifies the tenant and role independently of this check.
  const canResetDemoData = identity.environment === "development" && identity.role !== "viewer";

  return (
    <>
      <div className="border-b border-outline-variant/30 px-space-md py-2.5">
        <p className="truncate font-body-md text-[13px] font-medium text-on-surface">
          {identity.displayName}
        </p>
        <p className="truncate font-mono-code text-[11px] text-on-surface-variant">{identity.email}</p>
        <p className="mt-1 font-label-caps text-[10px] uppercase tracking-wider text-outline">{roleLabel}</p>
      </div>

      <Link
        href="/app/settings"
        role="menuitem"
        className="flex w-full items-center gap-2.5 px-space-md py-2.5 text-left font-body-sm text-[13px] text-on-surface transition-colors hover:bg-surface-container-high"
      >
        <Icon name="person" size={15} />
        Profile and settings
      </Link>

      {canResetDemoData ? <ResetDemoDataMenuItem /> : null}

      {/*
        POST, not a link: a GET sign-out can be fired by any third-party page
        embedding it, which would let another site end the user's session.
      */}
      <form action="/auth/sign-out" method="post">
        <button
          type="submit"
          role="menuitem"
          className="flex w-full items-center gap-2.5 border-t border-outline-variant/30 px-space-md py-2.5 text-left font-body-sm text-[13px] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          <Icon name="logout" size={15} />
          Sign out
        </button>
      </form>
    </>
  );
}

/**
 * Replaces the old per-page `DemoDataNotice` banners (one "Demo data" badge
 * lives on the workspace selector instead; see `WorkspaceSelector.tsx`) — the
 * one real action that notice used to expose, reset, now lives in this
 * existing menu rather than being repeated on six separate pages.
 */
function ResetDemoDataMenuItem() {
  const [state, formAction, pending] = useActionState(async (_previous: { error?: string }) => {
    const result = await resetDemoWorkspaceAction();
    return result.ok ? {} : { error: result.error ?? "Could not reset demo data." };
  }, {});

  return (
    <form action={formAction} className="border-t border-outline-variant/30">
      <button
        type="submit"
        role="menuitem"
        disabled={pending}
        aria-busy={pending}
        className="flex w-full items-center gap-2.5 px-space-md py-2.5 text-left font-body-sm text-[13px] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon name="cancel" size={15} />
        {pending ? "Resetting demo data…" : "Reset demo data"}
      </button>
      {state.error ? (
        <p role="alert" className="px-space-md pb-2 font-body-sm text-[12px] text-deny">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
