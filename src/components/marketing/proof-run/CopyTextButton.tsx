"use client";

import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

/**
 * Copies a non-secret block of text (shell commands) and says so twice: the button's own label changes to "Copied"
 * and a polite live region announces it, so the feedback reaches screen-reader users too. A clipboard failure (an
 * insecure context, a denied permission) is reported instead of silently pretending it worked.
 */
export function CopyTextButton({
  text,
  label = "Copy",
  announce = "Copied to clipboard",
  className = "",
  "aria-label": ariaLabel,
  "data-testid": testId,
}: {
  text: string;
  label?: string;
  announce?: string;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      next = "failed";
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={ariaLabel}
        data-testid={testId}
        data-state={state}
        className={className}
      >
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "copied" ? announce : state === "failed" ? "Copy failed. Select the text to copy it." : ""}
      </span>
    </>
  );
}
