"use client";

import { useEffect, useMemo, useState } from "react";

export type FlowPhase =
  | "approval_requested"
  | "approval_granted"
  | "approval_rejected"
  | "approval_stale"
  | "capability_issued"
  | "capability_issued_after_approval"
  | "reserved"
  | "dispatched"
  | "succeeded"
  | "succeeded_noop"
  | "failed"
  | "indeterminate"
  | "released";

export interface FlowStep {
  id: string;
  at: string;
  phase: FlowPhase;
  summary: string;
  mode: "mock" | "live" | null;
}

const COLOR = {
  ok: "#42e7a5",
  warn: "#f5b453",
  bad: "#e5677a",
  idle: "#3d494d",
  info: "#55d8ff",
  grey: "#869398",
};

function toneOf(phase: FlowPhase | null): keyof typeof COLOR {
  switch (phase) {
    case "succeeded":
    case "succeeded_noop":
    case "approval_granted":
    case "capability_issued":
    case "capability_issued_after_approval":
      return "ok";
    case "approval_requested":
    case "indeterminate":
      return "warn";
    case "failed":
    case "approval_rejected":
    case "approval_stale":
      return "bad";
    case "released":
      return "grey";
    case "reserved":
    case "dispatched":
      return "info";
    default:
      return "idle";
  }
}

/** Which node/edge each phase touches. */
function touches(phase: FlowPhase | null) {
  return {
    authority: phase !== null,
    edgeAgentAuthority: phase !== null,
    edgeAuthorityGithub: [
      "reserved",
      "dispatched",
      "succeeded",
      "succeeded_noop",
      "failed",
      "indeterminate",
      "released",
    ].includes(phase ?? ""),
    github: ["dispatched", "succeeded", "succeeded_noop", "failed", "indeterminate"].includes(phase ?? ""),
  };
}

/**
 * The agent -> Authority -> GitHub flow, driven ONLY by persisted execution
 * events. Nothing here is scripted: the highlighted step is a row from the
 * task's real event log, replayed in recorded order.
 */
export function ExecutionFlowGraph({ steps }: { steps: FlowStep[] }) {
  const [index, setIndex] = useState(steps.length - 1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (index >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIndex((i) => i + 1), steps.length > 12 ? 250 : 700);
    return () => clearTimeout(t);
  }, [playing, index, steps.length]);

  // Keep showing the latest event as new ones arrive after a refresh.
  useEffect(() => {
    if (!playing) setIndex(steps.length - 1);
  }, [steps.length, playing]);

  const current = steps[index] ?? null;
  const phase = current?.phase ?? null;
  const t = touches(phase);
  const tone = COLOR[toneOf(phase)];
  const mode = current?.mode ?? steps.find((s) => s.mode)?.mode ?? null;

  const seen = useMemo(() => steps.slice(0, index + 1), [steps, index]);
  const sawApproval = seen.some((s) => s.phase === "approval_requested");

  if (steps.length === 0) {
    return (
      <p className="font-body-md text-body-sm text-on-surface-variant" data-testid="flow-empty">
        No execution activity has been recorded for this task yet.
      </p>
    );
  }

  return (
    <div
      className="flex flex-col gap-space-md"
      data-testid="execution-flow"
      data-phase={phase ?? "none"}
      data-step-index={index}
      data-step-count={steps.length}
    >
      <div className="flex items-center justify-between gap-space-sm">
        <span className="font-body-sm text-body-sm text-outline">
          Replays this task&apos;s persisted execution events in order.
        </span>
        <button
          type="button"
          data-testid="flow-replay"
          className="rounded-lg border border-outline-variant/40 bg-surface-container-high px-space-md py-1 font-body-sm text-body-sm text-on-surface hover:bg-surface-container-highest"
          onClick={() => {
            setIndex(0);
            setPlaying(true);
          }}
        >
          Replay
        </button>
      </div>
      <svg
        viewBox="0 0 760 170"
        role="img"
        aria-label="Agent to Authority to GitHub execution flow"
        className="w-full max-w-3xl"
      >
        <line
          x1="150"
          y1="85"
          x2="310"
          y2="85"
          stroke={t.edgeAgentAuthority ? COLOR.info : COLOR.idle}
          strokeWidth="2"
          strokeDasharray={t.edgeAgentAuthority ? "0" : "4 6"}
        />
        <line
          x1="450"
          y1="85"
          x2="610"
          y2="85"
          stroke={t.edgeAuthorityGithub ? tone : COLOR.idle}
          strokeWidth="2"
          strokeDasharray={phase === "reserved" ? "6 5" : t.edgeAuthorityGithub ? "0" : "4 6"}
        />
        {(phase === "dispatched" || phase === "reserved") && playing ? (
          <circle r="5" fill={tone} cx="450" cy="85">
            <animate attributeName="cx" from="450" to="610" dur="0.7s" repeatCount="indefinite" />
          </circle>
        ) : null}
        <g data-node="agent">
          <rect x="20" y="55" width="130" height="60" rx="10" fill="#0b111b" stroke={COLOR.info} />
          <text x="85" y="90" textAnchor="middle" fill="#dfe2ec" fontSize="14">
            Agent
          </text>
        </g>
        <g data-node="authority">
          <rect
            x="310"
            y="45"
            width="140"
            height="80"
            rx="10"
            fill="#0b111b"
            stroke={
              t.authority
                ? sawApproval && phase === "approval_requested"
                  ? COLOR.warn
                  : COLOR.ok
                : COLOR.idle
            }
            strokeWidth="2"
          />
          <text x="380" y="82" textAnchor="middle" fill="#dfe2ec" fontSize="14">
            Authority
          </text>
          <text x="380" y="102" textAnchor="middle" fill="#869398" fontSize="11">
            gateway
          </text>
        </g>
        <g data-node="github" data-state={toneOf(phase)}>
          <rect
            x="610"
            y="55"
            width="130"
            height="60"
            rx="10"
            fill="#0b111b"
            stroke={t.github ? tone : COLOR.idle}
            strokeWidth="2"
          />
          <text x="675" y="83" textAnchor="middle" fill="#dfe2ec" fontSize="14">
            GitHub
          </text>
          <text
            x="675"
            y="102"
            textAnchor="middle"
            fill={mode === "live" ? COLOR.ok : COLOR.warn}
            fontSize="10"
          >
            {mode === "live" ? "LIVE" : mode === "mock" ? "MOCK (simulated)" : ""}
          </text>
        </g>
        <text x="380" y="150" textAnchor="middle" fill={tone} fontSize="12" data-testid="flow-caption">
          {current?.phase.replace(/_/g, " ")}
        </text>
      </svg>
      <ol className="flex flex-col gap-1" data-testid="flow-steps">
        {steps.map((s, i) => (
          <li
            key={s.id}
            data-testid={`flow-step-${s.phase}`}
            data-active={i === index}
            className={`flex items-baseline gap-2 font-body-sm text-body-sm ${i === index ? "text-on-surface" : i < index ? "text-on-surface-variant" : "text-outline"}`}
          >
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: i <= index ? COLOR[toneOf(s.phase)] : COLOR.idle }}
            />
            <span className="font-mono-code text-[11px]">{new Date(s.at).toISOString().slice(11, 19)}Z</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{s.summary}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
