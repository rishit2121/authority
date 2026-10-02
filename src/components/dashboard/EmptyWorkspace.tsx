"use client";

import { useActionState } from "react";

import { installDemoWorkspaceAction } from "@/app/app/actions";
import { Icon } from "@/components/ui/Icon";

/**
 * Shown alongside the primary onboarding steps, as a secondary, optional
 * path, for a tenant with no agents or tasks yet.
 *
 * The three statements below are load-bearing, not decorative: this button
 * mutates real database rows in this tenant, and a user must know exactly
 * what it does and doesn't do before clicking it.
 */
export function EmptyWorkspace() {
  const [state, formAction, pending] = useActionState(async (_previous: { error?: string }) => {
    const result = await installDemoWorkspaceAction();
    return result.ok ? {} : { error: result.error ?? "Could not install demo data." };
  }, {});

  return (
    <div className="flex flex-col gap-4 rounded-[10px] border border-line bg-paper-raised p-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[15px] font-semibold text-ink">Prefer to explore with sample data first?</h2>
        <p className="text-[13px] text-ink-soft">
          Install a simulated demo workspace to see how Authority evaluates a task before connecting your own
          agent.
        </p>
      </div>

      <ul className="flex flex-col gap-1.5 text-[13px] text-ink-soft">
        <li className="flex items-start gap-2">
          <Icon name="check_circle" size={14} className="mt-0.5 shrink-0 text-ink-soft" />
          Creates only local Authority database records, scoped to this workspace.
        </li>
        <li className="flex items-start gap-2">
          <Icon name="check_circle" size={14} className="mt-0.5 shrink-0 text-ink-soft" />
          Does not contact GitHub, Stripe, Gmail, Slack or any external service.
        </li>
        <li className="flex items-start gap-2">
          <Icon name="check_circle" size={14} className="mt-0.5 shrink-0 text-ink-soft" />
          Stores no external credentials of any kind.
        </li>
      </ul>

      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="flex h-10 items-center justify-center gap-2 rounded-lg border border-line-strong px-4 text-[14px] font-medium text-ink transition-colors hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-70"
        >
          <Icon name="smart_toy" size={16} />
          {pending ? "Installing…" : "Install demo workspace"}
        </button>
      </form>

      {state.error ? (
        <p role="alert" className="text-[13px] text-deny">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
