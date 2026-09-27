"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { decideRemediationAction } from "@/app/app/validation/actions";
import type { RemediationView } from "@/lib/validation/read-model";

import { REMEDIATION_LABEL } from "./labels";
import { StatusPill } from "./Pill";

interface Proposal {
  title?: string;
  rationale?: string;
  humanSteps?: string[];
  agentGuidance?: string | null;
  patch?: unknown;
}
interface Verification {
  campaignId?: string;
  before?: { runId?: string; verdict?: string; variant?: string };
  after?: { runId?: string; verdict?: string; failingSteps?: string[] };
}

export function RemediationCard({
  remediation,
  canDecide,
}: {
  remediation: RemediationView;
  canDecide: boolean;
}) {
  const p = remediation.proposal as Proposal;
  const v = (remediation.verification ?? null) as Verification | null;
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const decide = (decision: "accept" | "reject") =>
    start(async () => {
      setError(null);
      const r = await decideRemediationAction(remediation.id, decision, note);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });

  return (
    <article className="flex flex-col gap-space-sm rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-headline-sm text-headline-sm text-on-surface">{p.title ?? remediation.kind}</h4>
        <StatusPill status={remediation.status} />
        <span className="font-mono-code text-[11px] text-outline">
          {REMEDIATION_LABEL[remediation.kind] ?? remediation.kind}
        </span>
      </div>
      <p className="font-body-sm text-body-sm text-on-surface-variant">{p.rationale}</p>
      <p className="font-mono-code text-[11px] text-allow">
        Never broadens authority. Nothing is applied until a human accepts it, and accepting does not change
        any active contract or policy by itself.
      </p>
      {p.humanSteps?.length ? (
        <div>
          <div className="font-body-sm text-body-sm font-medium text-on-surface">To apply this for real</div>
          <ol className="list-decimal pl-5 font-body-sm text-body-sm text-on-surface-variant">
            {p.humanSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {p.agentGuidance ? (
        <div className="rounded-lg border border-primary/25 bg-primary/5 p-space-sm font-body-sm text-body-sm text-on-surface">
          <span className="text-primary">For the agent:</span> {p.agentGuidance}
        </div>
      ) : null}
      {p.patch ? (
        <details>
          <summary className="cursor-pointer font-body-sm text-body-sm text-on-surface-variant">
            Sandbox patch used for the before/after rerun
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-surface-container-low p-2 font-mono-code text-[11px] text-on-surface-variant">
            {JSON.stringify(p.patch, null, 1)}
          </pre>
        </details>
      ) : null}

      {v ? (
        <div className="grid gap-space-sm rounded-lg border border-outline-variant/30 bg-surface-container-low p-space-md sm:grid-cols-2">
          <div>
            <div className="font-body-sm text-body-sm text-on-surface-variant">
              Before (failing configuration)
            </div>
            <div className="font-mono-code text-[13px] text-deny">
              {v.before?.verdict ?? "fail"} · {v.before?.variant ?? "—"}
            </div>
          </div>
          <div>
            <div className="font-body-sm text-body-sm text-on-surface-variant">
              After (fix applied in sandbox)
            </div>
            <div
              className={`font-mono-code text-[13px] ${v.after?.verdict === "pass" ? "text-allow" : "text-deny"}`}
            >
              {v.after?.verdict ?? "—"}
              {v.after?.failingSteps?.length ? ` · failing: ${v.after.failingSteps.join(", ")}` : ""}
            </div>
          </div>
          {v.campaignId ? (
            <Link
              href={`/app/validation/campaigns/${v.campaignId}`}
              className="font-body-sm text-body-sm text-primary underline sm:col-span-2"
            >
              Open the verification run
            </Link>
          ) : null}
        </div>
      ) : null}

      {remediation.status === "proposed" ? (
        canDecide ? (
          <div className="flex flex-col gap-2">
            <label
              className="font-body-sm text-body-sm text-on-surface-variant"
              htmlFor={`note-${remediation.id}`}
            >
              Decision note (optional)
            </label>
            <input
              id={`note-${remediation.id}`}
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              className="rounded border border-outline-variant/40 bg-surface-container-low px-3 py-2 font-body-sm text-body-sm text-on-surface"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => decide("accept")}
                className="rounded-lg bg-primary px-4 py-2 font-body-sm text-body-sm font-medium text-on-primary disabled:opacity-50"
              >
                Accept and verify
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => decide("reject")}
                className="rounded-lg border border-outline-variant/50 px-4 py-2 font-body-sm text-body-sm text-on-surface disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        ) : (
          <p className="font-body-sm text-body-sm text-outline">Only security admins and above can decide.</p>
        )
      ) : remediation.decisionNote ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">Note: {remediation.decisionNote}</p>
      ) : null}
      {error ? (
        <p role="alert" className="font-body-sm text-body-sm text-deny">
          {error}
        </p>
      ) : null}
    </article>
  );
}
