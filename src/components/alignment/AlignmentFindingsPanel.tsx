"use client";

import { useState, useTransition } from "react";

import { decideAlignmentReviewAction, revealExternalContentAction } from "@/app/app/alignment/actions";
import { findingHelp } from "@/lib/alignment/finding-help";

export interface FindingView {
  type: string;
  severity: string;
  source: string;
  stepId?: string;
  field?: string;
  value?: string;
  explanation: string;
}

export interface ReviewView {
  id: string;
  kind: string;
  mode: string;
  policy: string;
  outcome: string;
  decision: string | null;
  objectiveVersion: number;
  contextRevision: number;
  findings: FindingView[];
  feedback: string | null;
  usage: { calls?: number; latencyMs?: number } | null;
  createdAt: string;
}

export interface ContentItemView {
  id: string;
  reviewId: string | null;
  origin: string;
  sourceKind: string;
  sourceLabel: string | null;
  status: string;
  byteSize: number;
  contentHash: string;
  retained: boolean;
  createdAt: string;
}

export interface ObjectivesView {
  version: number;
  source: string;
  requestText: string;
  taskInstructions: string[];
  prohibitions: string[];
}

const TONE: Record<string, string> = {
  aligned: "bg-allow/10 text-allow",
  passed: "bg-allow/10 text-allow",
  misaligned: "bg-deny/10 text-deny",
  quarantined: "bg-deny/10 text-deny",
  flagged: "bg-deny/10 text-deny",
  ambiguous: "bg-amber-500/15 text-amber-700",
  held: "bg-amber-500/15 text-amber-700",
  unreviewed: "bg-ink/10 text-ink-soft",
};

function Pill({ value }: { value: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${TONE[value] ?? "bg-ink/10 text-ink-soft"}`}
    >
      {value}
    </span>
  );
}

function Findings({ findings }: { findings: FindingView[] }) {
  const shown = findings.filter((f) => f.severity !== "info");
  if (shown.length === 0) return <p className="text-[13px] text-ink-soft">No findings.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {shown.map((f, i) => (
        <li key={i} className="text-[13px] text-ink">
          <span className="font-mono-code text-[12px] text-ink-soft">
            {f.type} · {f.severity} · {f.source}
            {f.stepId ? ` · step ${f.stepId}` : ""}
            {f.field ? ` · ${f.field}` : ""}
          </span>
          <div>{f.explanation}</div>
          {findingHelp(f.type) ? (
            <div className="text-[12px] text-ink-soft">
              <span className="font-medium text-ink">{findingHelp(f.type)!.title}.</span> Next:{" "}
              {findingHelp(f.type)!.next}
            </div>
          ) : null}
          {f.value ? (
            <div className="break-all font-mono-code text-[12px] text-ink-soft">{f.value}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Decide({ taskId, reviewId }: { taskId: string; reviewId: string }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (decision: "approved" | "rejected") =>
    start(async () => {
      const r = await decideAlignmentReviewAction(taskId, reviewId, decision, note);
      if (!r.ok) setError(r.error ?? "Could not record the decision.");
    });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        className="h-9 min-w-[220px] flex-1 rounded-lg border border-line-strong bg-paper px-3 text-[13px]"
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => act("approved")}
        data-testid={`alignment-approve-${reviewId}`}
        className="h-9 rounded-lg bg-primary px-3 text-[13px] font-medium text-on-primary disabled:opacity-60"
      >
        Approve this exception
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => act("rejected")}
        className="h-9 rounded-lg border border-line-strong px-3 text-[13px] disabled:opacity-60"
      >
        Reject
      </button>
      {error ? <span className="text-[13px] text-deny">{error}</span> : null}
    </div>
  );
}

function Reveal({ taskId, itemId }: { taskId: string; itemId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (text !== null) {
    return (
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-paper p-3 font-mono-code text-[12px] text-ink">
        {text}
      </pre>
    );
  }
  return (
    <span className="ml-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await revealExternalContentAction(taskId, itemId);
            if (!r.ok) setError(r.error ?? "Could not load.");
            else setText(r.data ?? "(no longer retained)");
          })
        }
        className="text-[13px] font-medium text-signal hover:underline"
      >
        View original
      </button>
      {error ? <span className="ml-2 text-[13px] text-deny">{error}</span> : null}
    </span>
  );
}

/** Task alignment on the task page: the objectives, every review, and every inspected piece of content. */
export function AlignmentFindingsPanel({
  taskId,
  objectives,
  reviews,
  items,
  canDecide,
}: {
  taskId: string;
  objectives: ObjectivesView | null;
  reviews: ReviewView[];
  items: ContentItemView[];
  canDecide: boolean;
}) {
  return (
    <section
      className="flex flex-col gap-3 rounded-[12px] border border-line bg-paper-raised p-5"
      data-testid="alignment-findings"
    >
      <h2 className="text-[15px] font-semibold text-ink">
        Task alignment{" "}
        <a
          href="/docs/task-alignment#findings"
          className="text-[12px] font-normal text-ink-soft underline underline-offset-2"
        >
          what findings mean
        </a>
      </h2>
      <p className="text-[13px] text-ink-soft" data-testid="alignment-checks-ran">
        Checks that ran: plan review{" "}
        {reviews.some((r) => r.kind === "plan")
          ? `${reviews.filter((r) => r.kind === "plan").length}×`
          : "— not run"}{" "}
        · tool-call checks {reviews.filter((r) => r.kind === "action").length}× · content screening{" "}
        {items.length
          ? `${items.length} item${items.length === 1 ? "" : "s"}`
          : "— nothing submitted (optional; not the same as passed)"}
      </p>

      {objectives ? (
        <div className="rounded-lg border border-line bg-paper p-4">
          <p className="text-[12px] uppercase tracking-wide text-ink-soft">
            Objectives v{objectives.version} ·{" "}
            {objectives.source === "original_request"
              ? "from the task's request"
              : "updated by the application"}
          </p>
          <p className="mt-1 text-[14px] text-ink">“{objectives.requestText}”</p>
          <ul className="mt-2 list-disc pl-5 text-[13px] text-ink">
            {objectives.taskInstructions.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
          {objectives.prohibitions.length ? (
            <p className="mt-2 text-[13px] text-ink-soft">Must not: {objectives.prohibitions.join("; ")}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-[13px] text-ink-soft">No objectives extracted yet.</p>
      )}

      {reviews.map((r) => (
        <article
          key={r.id}
          className="rounded-lg border border-line bg-paper p-4"
          data-testid="alignment-review"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium text-ink">
              {r.kind === "plan"
                ? "Plan review"
                : r.kind === "content"
                  ? "Content inspection"
                  : "Action check"}
            </span>
            <Pill value={r.outcome} />
            {r.decision ? <Pill value={r.decision === "approved" ? "aligned" : "misaligned"} /> : null}
            <span className="text-[12px] text-ink-soft">
              {r.mode} · {r.policy} · objectives v{r.objectiveVersion} · context r{r.contextRevision}
              {r.usage?.calls !== undefined
                ? ` · ${r.usage.calls} model call${r.usage.calls === 1 ? "" : "s"}`
                : ""}
              {r.decision ? ` · ${r.decision} by a person` : ""}
            </span>
          </div>
          <div className="mt-2">
            <Findings findings={r.findings} />
          </div>
          {canDecide && r.mode === "enforce" && r.outcome !== "aligned" && !r.decision ? (
            <Decide taskId={taskId} reviewId={r.id} />
          ) : null}
        </article>
      ))}

      {items.length ? (
        <div className="rounded-lg border border-line bg-paper p-4">
          <p className="text-[12px] uppercase tracking-wide text-ink-soft">External content</p>
          <ul className="mt-2 flex flex-col gap-2">
            {items.map((it) => (
              <li key={it.id} className="text-[13px] text-ink">
                <Pill value={it.status} /> <span className="ml-1">{it.sourceKind}</span>
                {it.sourceLabel ? <span className="text-ink-soft"> · {it.sourceLabel}</span> : null}
                <span className="text-ink-soft">
                  {" "}
                  · {it.origin} · {it.byteSize} B · sha256 {it.contentHash.slice(0, 12)}…
                </span>
                {canDecide && it.retained ? <Reveal taskId={taskId} itemId={it.id} /> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
