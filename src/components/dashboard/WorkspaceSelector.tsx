"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { CURRENT_WORKSPACE, DEMO_WORKSPACES } from "@/lib/mock";

/**
 * Mocked workspace switcher. Selecting an entry only updates which row shows
 * as current — there is nothing to actually switch to in Part 1.
 */
export function WorkspaceSelector({ collapsed = false }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(CURRENT_WORKSPACE.id);
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

  const active = DEMO_WORKSPACES.find((workspace) => workspace.id === current) ?? CURRENT_WORKSPACE;

  if (collapsed) {
    return (
      <div
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container font-mono-code text-[11px] font-semibold text-on-surface"
        title={active.name}
        aria-label={`Workspace: ${active.name}`}
      >
        {active.name.charAt(0)}
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
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-outline-variant/30 bg-surface-container px-space-md py-2 text-left transition-colors hover:border-outline-variant/60"
      >
        <span className="min-w-0">
          <span className="block truncate font-body-md text-body-md font-medium text-on-surface">
            {active.name}
          </span>
          <span className="block truncate font-body-sm text-[11px] text-on-surface-variant">
            {active.environment} workspace
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
          {DEMO_WORKSPACES.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              role="menuitemradio"
              aria-checked={workspace.id === current}
              onClick={() => {
                setCurrent(workspace.id);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between px-space-md py-2.5 text-left font-body-sm text-[13px] transition-colors hover:bg-surface-container-high ${
                workspace.id === current ? "text-primary" : "text-on-surface"
              }`}
            >
              {workspace.name}
              {workspace.id === current ? <Icon name="check_circle" size={14} /> : null}
            </button>
          ))}
          <div className="border-t border-outline-variant/30 px-space-md py-2.5 font-body-sm text-[12px] text-outline">
            Manage workspaces — not available in this demo
          </div>
        </div>
      ) : null}
    </div>
  );
}
