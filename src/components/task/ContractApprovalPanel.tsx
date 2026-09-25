"use client";

import { useEffect, useState, useTransition } from "react";

import {
  decideContractApprovalAction,
  listContractApprovalsAction,
  type ContractApprovalView,
} from "@/app/app/tasks/[taskId]/contract/actions";
import { Icon } from "@/components/ui/Icon";

const STATUS_STYLE: Record<ContractApprovalView["status"], string> = {
  pending: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
  approved: "border-allow/30 bg-allow/10 text-allow",
  rejected: "border-deny/30 bg-deny/10 text-deny",
  expired: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
};

/**
 * One required-approval slot per row, each independently decidable. The
 * server action re-derives eligibility on every decision (role/kind match,
 * self-approval prevention, distinct-approver-per-tier) — buttons here are
 * a convenience, never the actual gate.
 */
export function ContractApprovalPanel({ taskId, contractId }: { taskId: string; contractId: string }) {
  const [approvals, setApprovals] = useState<ContractApprovalView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  async function refresh() {
    const result = await listContractApprovalsAction(taskId, contractId);
    if (result.ok && result.data) setApprovals(result.data);
    else setError(result.error ?? "Could not load approvals.");
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, contractId]);

  function decide(approvalId: string, decision: "approved" | "rejected") {
    setError(null);
    const reason = reasonById[approvalId]?.trim();
    if (decision === "rejected" && !reason) {
      setError("A rejection reason is required.");
      return;
    }
    startTransition(async () => {
      const result = await decideContractApprovalAction(taskId, approvalId, decision, reason);
      if (result.ok) await refresh();
      else setError(result.error ?? "Could not record that decision.");
    });
  }

  if (approvals === null) return null;
  if (approvals.length === 0) return null;

  return (
    <section
      id="contract-approvals"
      aria-labelledby="contract-approvals-heading"
      className="rounded-xl border border-outline-variant/30 bg-surface-container"
    >
      <header className="border-b border-outline-variant/25 px-space-lg py-space-md">
        <h2
          id="contract-approvals-heading"
          className="font-headline-sm text-headline-sm font-semibold text-on-surface"
        >
          Required approvals
        </h2>
        <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">
          Every slot below must be approved before this contract can activate. A rejected slot blocks
          activation outright.
        </p>
      </header>
      <ul className="divide-y divide-outline-variant/20">
        {approvals.map((approval) => (
          <li key={approval.id} className="flex flex-col gap-space-sm px-space-lg py-space-md">
            <div className="flex flex-wrap items-center gap-space-sm">
              <Icon name="verified_user" size={14} className="text-outline" />
              <span className="font-mono-code text-[12px] text-on-surface">
                {approval.requiredKind === "task_owner" ? "Task owner" : `${approval.requiredRole}+`}
              </span>
              <span
                className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${STATUS_STYLE[approval.status]}`}
              >
                {approval.status}
              </span>
            </div>
            <p className="font-body-sm text-[12px] text-on-surface-variant">{approval.summary}</p>
            {approval.responseNote ? (
              <p className="font-body-sm text-[12px] text-on-surface-variant">
                Note: {approval.responseNote}
              </p>
            ) : null}

            {approval.status === "pending" ? (
              <div className="flex flex-col gap-space-xs sm:flex-row sm:items-center">
                <input
                  type="text"
                  placeholder="Reason (required to reject)"
                  value={reasonById[approval.id] ?? ""}
                  onChange={(e) => setReasonById((prev) => ({ ...prev, [approval.id]: e.target.value }))}
                  className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-space-md py-1.5 font-body-sm text-[12px] text-on-surface focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container sm:max-w-xs"
                />
                <div className="flex gap-space-sm">
                  <button
                    type="button"
                    onClick={() => decide(approval.id, "approved")}
                    disabled={pending}
                    className="rounded-lg bg-allow/15 px-space-md py-1.5 font-body-sm text-[12px] font-medium text-allow transition-colors hover:bg-allow/25 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(approval.id, "rejected")}
                    disabled={pending}
                    className="rounded-lg bg-deny/15 px-space-md py-1.5 font-body-sm text-[12px] font-medium text-deny transition-colors hover:bg-deny/25 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="px-space-lg pb-space-md font-body-sm text-body-sm text-deny">
          {error}
        </p>
      ) : null}
    </section>
  );
}
