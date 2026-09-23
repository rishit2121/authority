"use client";

import { useActionState } from "react";

import { installDemoWorkspaceAction } from "@/app/app/actions";
import { Icon } from "@/components/ui/Icon";

/**
 * Shown when a tenant has no agents or tasks yet.
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
    <div className="flex flex-col items-center gap-space-lg rounded-xl border border-outline-variant/30 bg-surface-container-low px-space-lg py-space-2xl text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-high text-outline">
        <Icon name="smart_toy" size={22} />
      </span>

      <div className="flex max-w-md flex-col gap-space-sm">
        <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
          No agents or tasks have been configured
        </h2>
        <p className="font-body-md text-body-md text-on-surface-variant">
          This workspace is otherwise real — your account and tenant membership are genuine. You can install a
          simulated demo workspace to see how Authority evaluates a task, or wait until your team creates its
          first agent and task.
        </p>
      </div>

      <ul className="flex max-w-md flex-col gap-space-xs text-left font-body-sm text-body-sm text-on-surface-variant">
        <li className="flex items-start gap-2">
          <Icon name="check_circle" size={14} className="mt-0.5 shrink-0 text-outline" />
          Creates only local Authority database records, scoped to this workspace.
        </li>
        <li className="flex items-start gap-2">
          <Icon name="check_circle" size={14} className="mt-0.5 shrink-0 text-outline" />
          Does not contact GitHub, Stripe, Gmail, Slack or any external service.
        </li>
        <li className="flex items-start gap-2">
          <Icon name="check_circle" size={14} className="mt-0.5 shrink-0 text-outline" />
          Stores no external credentials of any kind.
        </li>
      </ul>

      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-space-lg font-headline-sm text-body-md font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-70"
        >
          <Icon name="smart_toy" size={16} />
          {pending ? "Installing…" : "Install demo workspace"}
        </button>
      </form>

      {state.error ? (
        <p role="alert" className="font-body-sm text-body-sm text-deny">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
