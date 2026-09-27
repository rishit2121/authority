"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { cancelCampaignAction, rerunCampaignAction } from "@/app/app/validation/actions";
import { Icon } from "@/components/ui/Icon";
import type { CampaignMetrics } from "@/lib/validation/metrics";
import type {
  CampaignView as Campaign,
  FindingView,
  RemediationView,
  RunView,
} from "@/lib/validation/read-model";

import { AttackGraph } from "./AttackGraph";
import { CAUSE_LABEL, VERDICT_CLASS, fmtTime, humanize } from "./labels";
import { MetricsPanel } from "./MetricsPanel";
import { SeverityPill, StatusPill, SyntheticBadge } from "./Pill";
import { RemediationCard } from "./RemediationCard";
import { StepDetail } from "./StepDetail";

export interface CampaignData {
  campaign: Campaign;
  runs: RunView[];
  findings: FindingView[];
  remediations: RemediationView[];
}

const ACTIVE = new Set(["queued", "running"]);

export function CampaignView({
  initial,
  canRun,
  canDecide,
}: {
  initial: CampaignData;
  canRun: boolean;
  canDecide: boolean;
}) {
  const [data, setData] = useState<CampaignData>(initial);
  const [runId, setRunId] = useState<string | null>(initial.runs[0]?.id ?? null);
  const [seq, setSeq] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null); // null = show everything recorded
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const active = ACTIVE.has(data.campaign.status);
  const id = data.campaign.id;

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/validation/campaigns/${id}`, { cache: "no-store" });
    if (res.ok) setData((await res.json()) as CampaignData);
  }, [id]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [active, refresh]);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const run = useMemo(
    () => data.runs.find((r) => r.id === runId) ?? data.runs.at(-1) ?? null,
    [data.runs, runId],
  );
  const visible = cursor === null ? (run?.steps.length ?? 0) : cursor;
  const step =
    run?.steps.find((s) => s.seq === seq) ?? run?.steps.find((s) => s.verdict !== "pass") ?? run?.steps[0];

  const replay = () => {
    if (!run) return;
    if (timer.current) clearInterval(timer.current);
    const total = run.steps.length;
    // Pace from the recorded timestamps (capped), so the replay has the shape of the real run.
    setCursor(0);
    setPlaying(true);
    let i = 0;
    timer.current = setInterval(() => {
      i += 1;
      setCursor(i);
      setSeq(run.steps[Math.min(i, total) - 1]?.seq ?? null);
      if (i >= total) {
        if (timer.current) clearInterval(timer.current);
        setPlaying(false);
        setCursor(null);
      }
    }, 650);
  };

  const summary = data.campaign.summary as { metrics?: CampaignMetrics } | null;
  const { total, done } = data.campaign.progress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const onRerun = () =>
    startTransition(async () => {
      const r = await rerunCampaignAction(id);
      if (r.ok) router.push(`/app/validation/campaigns/${r.campaignId}`);
      else setMessage(r.error);
    });
  const onCancel = () =>
    startTransition(async () => {
      const r = await cancelCampaignAction(id);
      setMessage(r.ok ? "Cancellation requested. The campaign stops after the current run." : r.error);
    });

  const runFindings = data.findings.filter((f) => f.runId === run?.id);

  return (
    <div className="flex flex-col gap-space-lg">
      <header className="flex flex-col gap-space-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-headline-md text-headline-md text-on-surface">{data.campaign.name}</h2>
          <StatusPill status={data.campaign.status} />
          <SyntheticBadge />
        </div>
        <div className="font-mono-code text-[11px] text-outline">
          seed {data.campaign.seed} · started {fmtTime(data.campaign.startedAt ?? data.campaign.createdAt)}
          {data.campaign.finishedAt ? ` · finished ${fmtTime(data.campaign.finishedAt)}` : ""}
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Campaign progress"
          className="h-2 overflow-hidden rounded bg-surface-container-high"
        >
          <div className="h-full bg-primary motion-safe:transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <div className="font-body-sm text-body-sm text-on-surface-variant">
          {done} of {total} run(s)
          {active && data.campaign.progress.current ? ` · ${data.campaign.progress.current}` : ""}
        </div>
        <div className="flex flex-wrap gap-2">
          {active && canRun ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="rounded-lg border border-deny/40 px-3 py-1.5 font-body-sm text-body-sm text-deny disabled:opacity-50"
            >
              Cancel campaign
            </button>
          ) : null}
          {!active && canRun ? (
            <button
              type="button"
              onClick={onRerun}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-body-sm text-body-sm font-medium text-on-primary disabled:opacity-50"
            >
              <Icon name="replay" size={15} /> Run again
            </button>
          ) : null}
          {!active && summary?.metrics
            ? (["json", "md", "html"] as const).map((f) => (
                <a
                  key={f}
                  href={`/api/validation/campaigns/${id}/report?format=${f}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/50 px-3 py-1.5 font-body-sm text-body-sm text-on-surface hover:bg-surface-container-high"
                >
                  <Icon name="download" size={15} /> {f === "md" ? "Markdown" : f.toUpperCase()} report
                </a>
              ))
            : null}
        </div>
        {message ? (
          <p role="status" className="font-body-sm text-body-sm text-on-surface-variant">
            {message}
          </p>
        ) : null}
      </header>

      {data.runs.length === 0 ? (
        <p className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg font-body-sm text-body-sm text-on-surface-variant">
          {active ? "Waiting for the first run to start…" : "No runs were recorded."}
        </p>
      ) : (
        <div className="grid gap-space-lg lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside aria-label="Runs" className="flex max-h-[520px] flex-col gap-1 overflow-y-auto">
            {data.runs.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  setRunId(r.id);
                  setSeq(null);
                  setCursor(null);
                }}
                aria-current={run?.id === r.id ? "true" : undefined}
                className={`flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left ${
                  run?.id === r.id
                    ? "border-primary/40 bg-primary/10"
                    : "border-outline-variant/30 bg-surface-container hover:bg-surface-container-high"
                }`}
              >
                <span className="font-body-sm text-body-sm text-on-surface">{r.title}</span>
                <span className="flex items-center gap-2">
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono-code text-[10px] ${
                      VERDICT_CLASS[r.verdict ?? "running"]
                    }`}
                  >
                    {r.verdict ?? "running"}
                  </span>
                  <span className="font-mono-code text-[10px] text-outline">
                    {r.variant === "baseline" ? "baseline" : r.variant}
                  </span>
                </span>
              </button>
            ))}
          </aside>

          {run ? (
            <div className="flex min-w-0 flex-col gap-space-md">
              <div>
                <h3 className="font-headline-sm text-headline-sm text-on-surface">{run.title}</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant">{run.intent}</p>
                <p className="font-mono-code text-[11px] text-outline">
                  {humanize(run.category)} · variant {run.variant} · {run.scenarioKey}@{run.scenarioVersion}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={replay}
                  disabled={playing || run.steps.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/50 px-3 py-1.5 font-body-sm text-body-sm text-on-surface hover:bg-surface-container-high disabled:opacity-50"
                >
                  <Icon name="play_arrow" size={15} /> Replay step by step
                </button>
                <span className="font-mono-code text-[11px] text-outline">
                  {visible} of {run.steps.length} recorded steps shown
                </span>
              </div>
              <AttackGraph
                steps={run.steps}
                visible={visible}
                selectedSeq={step?.seq ?? null}
                onSelect={(s) => {
                  setSeq(s);
                  setCursor(null);
                }}
              />
              {step ? <StepDetail step={step} /> : null}

              <section
                aria-label="Blast radius"
                className="rounded-xl border border-outline-variant/30 bg-surface-container p-space-lg"
              >
                <h4 className="font-headline-sm text-headline-sm text-on-surface">Blast radius</h4>
                {run.effects.length === 0 ? (
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    No external effects were recorded in this run.
                  </p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1">
                    {run.effects.map((e, i) => (
                      <li
                        key={`${e.stepKey}-${i}`}
                        className={`rounded border px-2 py-1 font-mono-code text-[12px] ${
                          e.violates
                            ? "border-deny/40 bg-deny/10 text-deny"
                            : "border-allow/30 bg-allow/5 text-on-surface"
                        }`}
                      >
                        {e.tool}: {e.description}
                        {e.violates ? ` — OUTSIDE the boundary (${e.violates})` : " — inside the boundary"}
                      </li>
                    ))}
                  </ul>
                )}
                {run.metrics ? (
                  <p className="mt-2 font-mono-code text-[11px] text-outline">
                    Authority granted vs used: {run.metrics.unusedAuthority.exercisedTools} of{" "}
                    {run.metrics.unusedAuthority.allowedTools} allowed tool(s) exercised
                  </p>
                ) : null}
              </section>

              {runFindings.length > 0 ? (
                <section aria-label="Findings for this run" className="flex flex-col gap-space-sm">
                  <h4 className="font-headline-sm text-headline-sm text-on-surface">Findings</h4>
                  {runFindings.map((f) => (
                    <div
                      key={f.id}
                      className="flex flex-col gap-1 rounded-xl border border-outline-variant/30 bg-surface-container p-space-md"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityPill severity={f.severity} />
                        <StatusPill status={f.status} />
                        <span className="font-body-sm text-body-sm text-on-surface">{f.title}</span>
                      </div>
                      <div className="font-body-sm text-body-sm text-on-surface-variant">{f.summary}</div>
                      <div className="font-mono-code text-[11px] text-outline">
                        cause: {CAUSE_LABEL[f.cause] ?? f.cause}
                      </div>
                      {data.remediations
                        .filter((r) => r.findingId === f.id)
                        .map((r) => (
                          <RemediationCard key={r.id} remediation={r} canDecide={canDecide} />
                        ))}
                    </div>
                  ))}
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {summary?.metrics ? <MetricsPanel metrics={summary.metrics} /> : null}
      <p className="font-body-sm text-body-sm text-outline">
        <Link href="/app/validation/campaigns" className="underline">
          All runs
        </Link>
      </p>
    </div>
  );
}
