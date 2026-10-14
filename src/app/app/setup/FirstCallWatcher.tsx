"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const POLL_MS = 5_000;
const GIVE_UP_MS = 15 * 60_000;

/** Re-renders the (server-rendered) Setup page every few seconds until the first call shows up. */
export function FirstCallWatcher() {
  const router = useRouter();
  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      if (Date.now() - startedAt > GIVE_UP_MS) {
        clearInterval(id);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [router]);

  return (
    <p className="flex items-center gap-2 text-[13px] text-ink-soft" data-testid="setup-waiting">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-secondary opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-secondary" />
      </span>
      Waiting for your first call…
    </p>
  );
}
