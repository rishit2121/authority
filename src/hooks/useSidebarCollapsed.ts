"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "authority.sidebar.collapsed";

/**
 * Desktop sidebar collapse state, persisted per browser.
 *
 * Starts `false` on both server and first client render so hydration always
 * matches, then reads localStorage once mounted — the same pattern as
 * `useReducedMotion`. A stored preference can only ever apply after that
 * first paint, so there is a one-frame flash on repeat visits; acceptable for
 * a client-local preference with no server-rendered equivalent.
 */
export function useSidebarCollapsed(): [boolean, (value: boolean) => void] {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Private browsing or a blocked store: fall back to expanded.
    }
  }, []);

  const update = (value: boolean) => {
    setCollapsed(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // Nothing to persist to; the in-memory state still applies this session.
    }
  };

  return [collapsed, update];
}
