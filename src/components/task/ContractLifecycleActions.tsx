"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  activateContractAction,
  rejectContractAction,
  revokeContractAction,
  submitContractForApprovalAction,
} from "@/app/app/tasks/[taskId]/contract/actions";
import { Icon } from "@/components/ui/Icon";
import type { ContractStatus } from "@/lib/domain";

/**
 * Pre- and post-activation lifecycle actions. Submitting only moves the
 * contract to `awaiting_approval`; rejecting only moves it to `rejected`.
 * "Activate" is the one path that can grant real runtime authority — see
 * `activateContractAction`'s module doc for the re-verification it runs
 * before ever calling the database — and is offered here purely as a
 * convenience trigger; every real check happens server-side regardless of
 * whether this button is even rendered.
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
  const [showRevokeForm, setShowRevokeForm] = useState(false);

  const canActivate = status === "proposed" || status === "awaiting_approval";
  if (!canActivate && status !== "active") return null;

  function handleSubmitForApproval() {
    setError(null);
    startTransition(async () => {
      const result = await submitContractForApprovalAction(taskId, contractId);
      if (result.ok) router.refresh();
      else setError(result.error ?? "Could not submit for approval.");
    });
  }

  function handleActivate() {
    setError(null);
    startTransition(async () => {
      const result = await activateContractAction(taskId, contractId);
      if (result.ok) router.refresh();
      else setError(result.error ?? "Could not activate the contract.");
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

  function handleRevoke() {
    setError(null);
    if (reason.trim().length === 0) {
      setError("A revocation reason is required.");
      return;
    }
    startTransition(async () => {
      const result = await revokeContractAction(taskId, contractId, reason.trim());
      if (result.ok) router.refresh();
      else setError(result.error ?? "Could not revoke the contract.");
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
            className="flex items-center gap-1.5 rounded-lg border border-outline-variant/40 px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Icon name="verified_user" size={14} />
            {pending ? "Submitting…" : "Submit for approval"}
          </button>
        ) : null}

        {canActivate ? (
          <button
            type="button"
            onClick={handleActivate}
            disabled={pending}
            aria-busy={pending}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Icon name="verified_user" size={14} />
            {pending ? "Activating…" : "Activate"}
          </button>
        ) : null}

        {canActivate && !showRejectForm ? (
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

        {status === "active" && !showRevokeForm ? (
          <button
            type="button"
            onClick={() => setShowRevokeForm(true)}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-lg border border-deny/30 px-space-md py-2 font-headline-sm text-body-sm font-medium text-deny transition-colors hover:bg-deny/10 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Icon name="cancel" size={14} />
            Revoke
          </button>
        ) : null}
      </div>

      {showRevokeForm ? (
        <div className="flex flex-col gap-space-xs">
          <label htmlFor="revoke-reason" className="font-body-sm text-body-sm font-medium text-on-surface">
            Revocation reason
          </label>
          <textarea
            id="revoke-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full resize-y rounded-lg border border-outline-variant/40 bg-surface-container-low px-space-md py-2 font-body-md text-body-sm text-on-surface focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container"
          />
          <div className="flex gap-space-sm">
            <button
              type="button"
              onClick={handleRevoke}
              disabled={pending}
              aria-busy={pending}
              className="rounded-lg bg-deny/15 px-space-md py-1.5 font-body-sm text-body-sm font-medium text-deny transition-colors hover:bg-deny/25 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {pending ? "Revoking…" : "Confirm revocation"}
            </button>
            <button
              type="button"
              onClick={() => setShowRevokeForm(false)}
              disabled={pending}
              className="rounded-lg px-space-md py-1.5 font-body-sm text-body-sm text-on-surface-variant hover:text-on-surface"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

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
