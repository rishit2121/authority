"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  rejectContractAction,
  submitContractForApprovalAction,
} from "@/app/app/tasks/[taskId]/contract/actions";
import { Icon } from "@/components/ui/Icon";
import type { ContractStatus } from "@/lib/domain";

/**
 * The two pre-activation lifecycle actions a proposed contract can take.
 * Neither mints a capability or activates anything — submitting only moves
 * the contract to `awaiting_approval`; rejecting only moves it to
 * `rejected`. Activation has no client-facing path at all in this phase.
 */
export function ContractLifecycleActions({
  taskId,
  contractId,
  status,
}: {
  taskId: string;
  contractId: string;
  status: ContractStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  if (status !== "proposed" && status !== "awaiting_approval") return null;

  function handleSubmitForApproval() {
    setError(null);
    startTransition(async () => {
      const result = await submitContractForApprovalAction(taskId, contractId);
      if (result.ok) router.refresh();
      else setError(result.error ?? "Could not submit for approval.");
    });
  }

  function handleReject() {
    setError(null);
    if (reason.trim().length === 0) {
      setError("A rejection reason is required.");
      return;
    }
    startTransition(async () => {
      const result = await rejectContractAction(taskId, contractId, reason.trim());
      if (result.ok) router.refresh();
      else setError(result.error ?? "Could not reject the contract.");
    });
  }

  return (
    <div className="flex flex-col gap-space-sm rounded-lg border border-outline-variant/30 bg-surface-container px-space-md py-space-sm">
      <div className="flex flex-wrap items-center gap-space-sm">
        {status === "proposed" ? (
          <button
            type="button"
            onClick={handleSubmitForApproval}
            disabled={pending}
            aria-busy={pending}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Icon name="verified_user" size={14} />
            {pending ? "Submitting…" : "Submit for approval"}
          </button>
        ) : null}

        {!showRejectForm ? (
          <button
            type="button"
            onClick={() => setShowRejectForm(true)}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-lg border border-deny/30 px-space-md py-2 font-headline-sm text-body-sm font-medium text-deny transition-colors hover:bg-deny/10 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Icon name="cancel" size={14} />
            Reject
          </button>
        ) : null}
      </div>

      {showRejectForm ? (
        <div className="flex flex-col gap-space-xs">
          <label htmlFor="reject-reason" className="font-body-sm text-body-sm font-medium text-on-surface">
            Rejection reason
          </label>
          <textarea
            id="reject-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full resize-y rounded-lg border border-outline-variant/40 bg-surface-container-low px-space-md py-2 font-body-md text-body-sm text-on-surface focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container"
          />
          <div className="flex gap-space-sm">
            <button
              type="button"
              onClick={handleReject}
              disabled={pending}
              aria-busy={pending}
              className="rounded-lg bg-deny/15 px-space-md py-1.5 font-body-sm text-body-sm font-medium text-deny transition-colors hover:bg-deny/25 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {pending ? "Rejecting…" : "Confirm rejection"}
            </button>
            <button
              type="button"
              onClick={() => setShowRejectForm(false)}
              disabled={pending}
              className="rounded-lg px-space-md py-1.5 font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="font-body-sm text-body-sm text-deny">
          {error}
        </p>
      ) : null}
    </div>
  );
}
