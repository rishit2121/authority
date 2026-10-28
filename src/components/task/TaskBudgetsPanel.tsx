"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { raiseTaskBudgetsAction } from "@/app/app/tasks/[taskId]/contract/actions";
import { Icon } from "@/components/ui/Icon";

export interface TaskBudgetRow {
  tool: string;
  /** Pinned values, e.g. "channel = C-ops"; empty when the action pins nothing. */
  constraintsLabel: string;
  allowance: number;
  used: number;
}

/**
 * Task-wide budgets: what each action may still use across every contract version of the task. Re-preparing a task
 * does not reset them; renewing does (admins and owners; the database enforces the role and records who did it).
 */
export function TaskBudgetsPanel({
  taskId,
  rows,
  canRenew,
}: {
  taskId: string;
  rows: TaskBudgetRow[];
  canRenew: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);

  if (rows.length === 0) return null;

  function handleRenew() {
    setError(null);
    startTransition(async () => {
      const result = await raiseTaskBudgetsAction(taskId, note);
      if (result.ok) {
        setConfirming(false);
        setNote("");
        router.refresh();
      } else setError(result.error ?? "Could not renew budgets.");
    });
  }

  return (
    <section className="flex flex-col gap-space-sm rounded-lg border border-outline-variant/30 bg-surface-container px-space-md py-space-md">
      <div className="flex flex-col gap-1">
        <h2 className="font-headline-sm text-body-md font-medium text-on-surface">Budgets</h2>
        <p className="text-body-sm text-on-surface-variant">
          Counted across every contract version of this task. Re-preparing the task does not reset them.
        </p>
      </div>
      <table className="w-full text-left text-body-sm">
        <thead className="text-on-surface-variant">
          <tr>
            <th className="py-1 pr-space-sm font-medium">Action</th>
            <th className="py-1 pr-space-sm font-medium">Allowed</th>
            <th className="py-1 pr-space-sm font-medium">Used</th>
            <th className="py-1 font-medium">Left</th>
          </tr>
        </thead>
        <tbody className="text-on-surface">
          {rows.map((r) => (
            <tr key={`${r.tool} ${r.constraintsLabel}`} className="border-t border-outline-variant/20">
              <td className="py-1 pr-space-sm">
                <span className="font-mono">{r.tool}</span>
                {r.constraintsLabel ? (
                  <span className="text-on-surface-variant"> · {r.constraintsLabel}</span>
                ) : null}
              </td>
              <td className="py-1 pr-space-sm">{r.allowance}</td>
              <td className="py-1 pr-space-sm">{r.used}</td>
              <td className="py-1">{Math.max(0, r.allowance - r.used)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canRenew ? (
        confirming ? (
          <div className="flex flex-col gap-space-sm">
            <label className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
              Reason (recorded)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                className="rounded-lg border border-outline-variant/40 bg-surface px-space-sm py-1.5 text-on-surface"
              />
            </label>
            <div className="flex gap-space-sm">
              <button
                type="button"
                onClick={handleRenew}
                disabled={pending}
                aria-busy={pending}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Icon name="replay" size={14} />
                {pending ? "Renewing…" : "Renew budgets"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="rounded-lg border border-outline-variant/40 px-space-md py-2 text-body-sm text-on-surface transition-colors hover:bg-surface-container-high"
              >
                Cancel
              </button>
            </div>
            <p className="text-body-sm text-on-surface-variant">
              Raises each action&apos;s task-wide allowance by the active contract&apos;s limit, on top of
              what the task has used. The contract&apos;s own limits still apply: if it has used them, the
              backend re-prepares the task and the new version can use the raised allowance.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex w-fit items-center gap-1.5 rounded-lg border border-outline-variant/40 px-space-md py-2 font-headline-sm text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-high"
          >
            <Icon name="replay" size={14} />
            Renew budgets
          </button>
        )
      ) : null}
      {error ? <p className="text-body-sm text-error">{error}</p> : null}
    </section>
  );
}
