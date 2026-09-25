"use client";

import { useActionState } from "react";

import { resetDemoWorkspaceAction } from "@/app/app/actions";
import { Icon } from "@/components/ui/Icon";

/**
 * Says plainly that the product records shown are simulated, even though
 * they are now real, persisted database rows.
 *
 * As of Part 2B.2, "demo data" describes the *content* — a fixed, hardcoded
 * scenario the demo installer wrote — not the storage. Every row is a real
 * `agents`/`tasks`/... record in this tenant's own Supabase data, tenant-
 * isolated exactly like anything a real workflow would create. What's still
 * simulated is what the scenario depicts: no agent, credential or external
 * service is actually connected.
 *
 * `showReset` is only meaningful for a role that can actually call
 * `reset_demo_workspace()` — the server action itself re-verifies this
 * regardless of what the button renders, so hiding it here is presentation,
 * not enforcement.
 */
export function DemoDataNotice({
  className,
  showReset = false,
}: {
  className?: string;
  showReset?: boolean;
}) {
  const [state, formAction, pending] = useActionState(async (_previous: { error?: string }) => {
    const result = await resetDemoWorkspaceAction();
    return result.ok ? {} : { error: result.error ?? "Could not reset demo data." };
  }, {});

  return (
    <div
      className={`flex flex-col gap-space-sm rounded-lg border border-outline-variant/30 bg-surface-container px-space-md py-2.5 ${className ?? ""}`}
    >
      <div className="flex items-start gap-space-sm">
        <Icon name="warning" size={15} className="mt-0.5 shrink-0 text-outline" />
        <p className="font-body-md text-body-sm text-on-surface-variant">
          <span className="font-medium text-on-surface">Demo data.</span> Your account and workspace are real,
          and these are genuine, tenant-scoped database records — but the scenario they depict is simulated.
          No agent, credential or external service is actually connected.
        </p>
        {showReset ? (
          <form action={formAction} className="ml-auto shrink-0">
            <button
              type="submit"
              disabled={pending}
              aria-busy={pending}
              className="flex items-center gap-1.5 rounded-md border border-outline-variant/40 px-space-sm py-1 font-body-sm text-[12px] text-on-surface-variant transition-colors hover:border-deny/40 hover:text-deny disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon name="cancel" size={13} />
              {pending ? "Resetting…" : "Reset demo data"}
            </button>
          </form>
        ) : null}
      </div>
      {state.error ? (
        <p role="alert" className="font-body-sm text-[12px] text-deny">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
