"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  decideRuntimeApprovalAction,
  setRuntimeApprovalClassesAction,
  type GithubActionResult,
} from "@/app/app/integrations/github/actions";
import type { RuntimeApprovalView } from "@/lib/github/read-model";

const BTN =
  "rounded-lg px-space-md py-1.5 font-body-sm text-body-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const STATUS_TONE: Record<string, string> = {
  pending: "border-secondary/40 bg-secondary/10 text-secondary",
  approved: "border-allow/30 bg-allow/10 text-allow",
  consumed: "border-allow/30 bg-allow/10 text-allow",
  rejected: "border-deny/40 bg-deny/10 text-deny",
  stale: "border-deny/40 bg-deny/10 text-deny",
  expired: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
};

const TRIGGER: Record<string, string> = {
  semantic_high_risk: "Semantic review rated this high risk",
  policy_class: "Tenant policy requires approval for this risk class",
  registry_requires_approval: "The registry requires approval for this operation",
};

function DecisionForm({ id, canDecide }: { id: string; canDecide: boolean }) {
  const [note, setNote] = useState("");
  const [result, setResult] = useState<GithubActionResult | null>(null);
  const [pending, start] = useTransition();
  if (!canDecide)
    return (
      <p className="font-body-sm text-body-sm text-outline">
        Deciding requires the security administrator role or above.
      </p>
    );
  const decide = (decision: "approve" | "reject") =>
    start(async () => setResult(await decideRuntimeApprovalAction(id, decision, note)));
  return (
    <div className="flex flex-col gap-space-sm">
      <label htmlFor={`rn-${id}`} className="font-body-sm text-body-sm text-on-surface">
        Note (optional)
      </label>
      <input
        id={`rn-${id}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
        className="rounded-lg border border-outline-variant/40 bg-surface-container px-space-md py-1.5 font-body-sm text-body-sm text-on-surface"
      />
      <div className="flex gap-space-sm">
        <button
          type="button"
          disabled={pending}
          data-testid={`approve-${id}`}
          onClick={() => decide("approve")}
          className={`${BTN} bg-allow/15 text-allow hover:bg-allow/25`}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={pending}
          data-testid={`reject-${id}`}
          onClick={() => decide("reject")}
          className={`${BTN} bg-deny/15 text-deny hover:bg-deny/25`}
        >
          Reject
        </button>
      </div>
      {result ? (
        <p
          role={result.ok ? "status" : "alert"}
          data-testid="approval-result"
          className={`font-body-sm text-body-sm ${result.ok ? "text-allow" : "text-deny"}`}
        >
          {result.ok ? result.message : result.error}
        </p>
      ) : null}
    </div>
  );
}

export function RuntimeApprovalsPanel({
  approvals,
  canDecide,
}: {
  approvals: RuntimeApprovalView[];
  canDecide: boolean;
}) {
  return (
    <section
      aria-labelledby="runtime-approvals-heading"
      className="flex flex-col gap-space-md"
      data-testid="runtime-approvals"
    >
      <div>
        <h2
          id="runtime-approvals-heading"
          className="font-headline-sm text-headline-sm font-semibold text-on-surface"
        >
          Runtime approvals
        </h2>
        <p className="mt-1 max-w-2xl font-body-md text-body-sm text-on-surface-variant">
          Agent calls that need a human decision before a capability exists. Each is bound to the exact
          request, contract version and argument hash. Approving mints nothing by itself: the agent
          re-requests, and every input is re-checked first. A changed contract, policy, agent, key or
          integration makes the approval stale.
        </p>
      </div>
      {approvals.length === 0 ? (
        <p className="font-body-md text-body-sm text-outline" data-testid="no-runtime-approvals">
          No runtime approvals yet.
        </p>
      ) : (
        approvals.map((a) => (
          <article
            key={a.id}
            data-testid={`runtime-approval-${a.status}`}
            className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
          >
            <div className="flex flex-wrap items-start justify-between gap-space-sm">
              <div>
                <p className="font-mono-code text-[13px] text-on-surface">
                  {a.tool}
                  {a.resource ? ` on ${a.resource}` : ""}
                </p>
                <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">
                  Task{" "}
                  <Link href={`/app/tasks/${a.taskId}`} className="text-primary underline">
                    {a.taskId.slice(0, 8)}
                  </Link>{" "}
                  · contract v{a.contractVersion} · {a.riskClass} risk
                </p>
              </div>
              <span
                data-testid="runtime-approval-status"
                className={`rounded border px-2 py-0.5 font-mono-code text-[11px] ${STATUS_TONE[a.status] ?? ""}`}
              >
                {a.status}
              </span>
            </div>
            <p className="mt-space-sm font-body-md text-body-sm text-on-surface">
              {TRIGGER[a.trigger] ?? a.trigger}.
            </p>
            <dl className="mt-space-sm grid grid-cols-2 gap-space-sm sm:grid-cols-4 font-body-sm text-body-sm">
              <div>
                <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
                  Evidence
                </dt>
                <dd className="text-on-surface-variant">
                  {(a.evidence.reasonCodes ?? []).join(", ") || "—"}
                </dd>
              </div>
              <div>
                <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
                  Semantic
                </dt>
                <dd className="text-on-surface-variant">
                  {a.evidence.semantic
                    ? `${a.evidence.semantic.state}, ${a.evidence.semantic.riskLevel}`
                    : "none"}
                </dd>
              </div>
              <div>
                <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">
                  Approvals
                </dt>
                <dd className="text-on-surface-variant" data-testid="approval-count">
                  {a.approvals} of {a.requiredApprovals}
                </dd>
              </div>
              <div>
                <dt className="font-label-caps text-[10px] uppercase tracking-wider text-outline">Expires</dt>
                <dd className="text-on-surface-variant">{new Date(a.expiresAt).toLocaleString()}</dd>
              </div>
            </dl>
            {a.staleReason ? (
              <p className="mt-space-sm font-body-sm text-body-sm text-deny" data-testid="stale-reason">
                Stale: {a.staleReason}. It can no longer be granted.
              </p>
            ) : null}
            {a.status === "pending" ? (
              <div className="mt-space-md border-t border-outline-variant/20 pt-space-md">
                <DecisionForm id={a.id} canDecide={canDecide} />
              </div>
            ) : null}
          </article>
        ))
      )}
    </section>
  );
}

export function ApprovalPolicyForm({ initial, canEdit }: { initial: string[]; canEdit: boolean }) {
  const [classes, setClasses] = useState<string[]>(initial);
  const [result, setResult] = useState<GithubActionResult | null>(null);
  const [pending, start] = useTransition();
  const toggle = (c: string) =>
    setClasses((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  return (
    <section
      aria-labelledby="approval-policy-heading"
      className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
      data-testid="approval-policy"
    >
      <h2
        id="approval-policy-heading"
        className="font-headline-sm text-body-lg font-semibold text-on-surface"
      >
        Require approval by risk class
      </h2>
      <p className="mt-1 font-body-sm text-body-sm text-outline">
        Calls in a checked class are narrowed from allow to require-approval. Reads are low, creates/updates
        medium, deletes and admin high.
      </p>
      <div className="mt-space-sm flex flex-wrap items-center gap-space-md">
        {["low", "medium", "high"].map((c) => (
          <label key={c} className="flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={classes.includes(c)}
              onChange={() => toggle(c)}
              data-testid={`approval-class-${c}`}
            />{" "}
            {c}
          </label>
        ))}
        <button
          type="button"
          disabled={!canEdit || pending}
          data-testid="approval-policy-save"
          onClick={() => start(async () => setResult(await setRuntimeApprovalClassesAction(classes)))}
          className={`${BTN} border border-outline-variant/40 bg-surface-container-high text-on-surface`}
        >
          Save
        </button>
      </div>
      {result ? (
        <p
          role={result.ok ? "status" : "alert"}
          className={`mt-1 font-body-sm text-body-sm ${result.ok ? "text-allow" : "text-deny"}`}
        >
          {result.ok ? "Saved." : result.error}
        </p>
      ) : null}
    </section>
  );
}
