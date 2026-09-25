"use client";

import { useActionState } from "react";

import { resolveApprovalAction } from "@/app/app/actions";
import { Icon } from "@/components/ui/Icon";

interface State {
  ok: boolean;
  error?: string;
}

/**
 * Approve/reject controls for one pending approval.
 *
 * A fixed, two-way state transition — pending to approved or pending to
 * rejected — and nothing else. Resolving here records the human decision
 * only: it mints no capability and triggers no execution.
 */
export function ApprovalDecisionForm({ approvalId, canDecide }: { approvalId: string; canDecide: boolean }) {
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_previous, formData) => {
      const decision = String(formData.get("decision") ?? "");
      const reason = String(formData.get("reason") ?? "");
      const result = await resolveApprovalAction(approvalId, decision, reason);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    { ok: true },
  );

  if (!canDecide) {
    return (
      <p className="font-body-sm text-body-sm text-outline">
        Resolving an approval requires the security administrator role or above.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-space-sm">
      <label
        htmlFor={`reason-${approvalId}`}
        className="font-body-sm text-body-sm font-medium text-on-surface"
      >
        Reason (optional)
      </label>
      <textarea
        id={`reason-${approvalId}`}
        name="reason"
        rows={2}
        className="w-full resize-y rounded-lg border border-outline-variant/40 bg-surface-container px-space-md py-2 font-body-md text-body-sm text-on-surface focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container"
      />
      <div className="flex gap-space-sm">
        <button
          type="submit"
          name="decision"
          value="approved"
          disabled={pending}
          className="flex items-center gap-1.5 rounded-lg bg-allow/15 px-space-md py-2 font-body-sm text-body-sm font-medium text-allow transition-colors hover:bg-allow/25 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="check_circle" size={14} />
          Approve
        </button>
        <button
          type="submit"
          name="decision"
          value="rejected"
          disabled={pending}
          className="flex items-center gap-1.5 rounded-lg bg-deny/15 px-space-md py-2 font-body-sm text-body-sm font-medium text-deny transition-colors hover:bg-deny/25 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="cancel" size={14} />
          Reject
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="font-body-sm text-body-sm text-deny">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
