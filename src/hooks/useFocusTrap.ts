"use client";

import { useEffect } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps focus inside `containerRef` while `active`, closes on Escape, and
 * returns focus to `returnFocusRef` on close — the behavior the mobile
 * navigation drawer needs to not leak focus into the page behind it.
 */
export function useFocusTrap({
  active,
  containerRef,
  returnFocusRef,
  onClose,
}: {
  active: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    const first = focusables()[0];
    first?.focus();

    const returnFocusElement = returnFocusRef.current;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusables();
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];

      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Captured now: by the time this cleanup runs the ref may already
      // point elsewhere (e.g. the trigger unmounting during navigation).
      returnFocusElement?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
