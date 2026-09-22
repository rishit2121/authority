"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { DEMO_USER } from "@/lib/mock";

/**
 * Bottom-of-sidebar account control.
 *
 * "Sign out" is intentionally inert beyond showing a notice: there is no real
 * session to end yet. Functional auth arrives with Supabase in Part 2.
 */
export function UserMenu({ collapsed = false }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const noticeTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  useEffect(() => () => clearTimeout(noticeTimeout.current), []);

  const handleDemoSignOut = () => {
    setOpen(false);
    setNotice(true);
    clearTimeout(noticeTimeout.current);
    noticeTimeout.current = setTimeout(() => setNotice(false), 4000);
  };

  const avatar = (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary font-mono-code text-[11px] font-semibold text-on-primary">
      {DEMO_USER.initials}
    </span>
  );

  if (collapsed) {
    return (
      <div
        ref={rootRef}
        className="relative flex justify-center"
        title={`${DEMO_USER.name} · ${DEMO_USER.team}`}
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Account menu for ${DEMO_USER.name}`}
        >
          {avatar}
        </button>
        {open ? (
          <div
            role="menu"
            aria-label="Account"
            className="absolute bottom-0 left-full z-30 ml-2 w-52 overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container-highest shadow-xl"
          >
            <MenuItems onSignOut={handleDemoSignOut} />
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
            {DEMO_USER.name}
          </span>
          <span className="block truncate font-body-sm text-[11px] text-on-surface-variant">
            {DEMO_USER.team}
          </span>
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
          <MenuItems onSignOut={handleDemoSignOut} />
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {notice ? "This is a demo account. Sign out is not wired to real authentication yet." : ""}
      </p>
      {notice ? (
        <div className="absolute inset-x-0 bottom-full z-30 mb-1.5 rounded-lg border border-outline-variant/40 bg-surface-container-highest px-space-md py-2.5 font-body-sm text-[12px] text-on-surface-variant shadow-xl">
          Demo account — sign-out isn&apos;t wired to real authentication yet. That arrives with Supabase in
          Part 2.
        </div>
      ) : null}
    </div>
  );
}

function MenuItems({ onSignOut }: { onSignOut: () => void }) {
  return (
    <>
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2.5 px-space-md py-2.5 text-left font-body-sm text-[13px] text-on-surface transition-colors hover:bg-surface-container-high"
      >
        <Icon name="person" size={15} />
        Profile
      </button>
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2.5 px-space-md py-2.5 text-left font-body-sm text-[13px] text-on-surface transition-colors hover:bg-surface-container-high"
      >
        <Icon name="lock" size={15} />
        Organization settings
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onSignOut}
        className="flex w-full items-center gap-2.5 border-t border-outline-variant/30 px-space-md py-2.5 text-left font-body-sm text-[13px] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
      >
        <Icon name="logout" size={15} />
        Sign out (demo)
      </button>
    </>
  );
}
