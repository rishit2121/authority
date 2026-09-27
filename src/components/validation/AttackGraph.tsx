"use client";

import { GRAPH_COLORS } from "@/components/graph/graph-data";
import type { StepView } from "@/lib/validation/read-model";

import { CONTROL_LABEL } from "./labels";

const ROW = 64;
const TOP = 24;
const COL = { root: 12, step: 190, control: 470, outcome: 720 } as const;
const W = 920;

const TONE = {
  pass: GRAPH_COLORS.allow,
  fail: "#ff6b7a",
  error: "#f5b342",
  skipped: GRAPH_COLORS.dormant,
} as const;

function short(text: string, n: number) {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

function outcomeText(s: StepView): string {
  const a = s.actual as { execution?: string; finalDecision?: string | null; resultCode?: string | null };
  if (a.execution === "executed") return "effect happened";
  if (a.execution === "blocked") return a.resultCode ? `refused · ${short(a.resultCode, 22)}` : "refused";
  return a.finalDecision ? `decision: ${a.finalDecision}` : "no effect";
}

/**
 * Attack tree for one run: the untrusted agent, each step it took, the control that answered it, and the outcome.
 * `visible` (a count of persisted steps) drives the reveal, so replay shows exactly what was recorded, in order.
 */
export function AttackGraph({
  steps,
  visible,
  selectedSeq,
  onSelect,
}: {
  steps: StepView[];
  visible: number;
  selectedSeq: number | null;
  onSelect: (seq: number) => void;
}) {
  const height = TOP * 2 + Math.max(1, steps.length) * ROW;
  const mid = height / 2;
  return (
    <div className="overflow-x-auto rounded-xl border border-outline-variant/30 bg-[#070b11]">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={`Attack tree with ${steps.length} step(s)`}
        style={{ minWidth: 720 }}
        className="block w-full"
      >
        <g>
          <rect
            x={COL.root}
            y={mid - 26}
            width={150}
            height={52}
            rx={10}
            fill={GRAPH_COLORS.nodeFill}
            stroke={GRAPH_COLORS.edge}
            strokeOpacity={0.7}
          />
          <text x={COL.root + 75} y={mid - 4} textAnchor="middle" fontSize={12} fill={GRAPH_COLORS.text}>
            Agent (untrusted)
          </text>
          <text x={COL.root + 75} y={mid + 13} textAnchor="middle" fontSize={10} fill={GRAPH_COLORS.muted}>
            plan + injected input
          </text>
        </g>
        {steps.map((s, i) => {
          const y = TOP + i * ROW + ROW / 2;
          const shown = i < visible;
          const tone = TONE[s.verdict];
          const sel = selectedSeq === s.seq;
          const control = CONTROL_LABEL[s.control ?? "none"] ?? "—";
          const executed = (s.actual as { execution?: string }).execution === "executed";
          return (
            <g
              key={s.id}
              style={{ opacity: shown ? 1 : 0.12 }}
              className="motion-safe:transition-opacity motion-safe:duration-300"
            >
              <path
                d={`M ${COL.root + 150} ${mid} C ${COL.root + 190} ${mid}, ${COL.step - 40} ${y}, ${COL.step} ${y}`}
                fill="none"
                stroke={GRAPH_COLORS.edge}
                strokeOpacity={0.55}
                strokeWidth={1.6}
              />
              <g
                role="button"
                tabIndex={0}
                aria-label={`Step ${s.seq + 1}: ${s.label}. Verdict ${s.verdict}.`}
                onClick={() => onSelect(s.seq)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(s.seq);
                  }
                }}
                className="cursor-pointer outline-none focus-visible:[&>rect]:stroke-white"
              >
                <rect
                  x={COL.step}
                  y={y - 25}
                  width={250}
                  height={50}
                  rx={9}
                  fill={sel ? "#132033" : GRAPH_COLORS.nodeFill}
                  stroke={tone}
                  strokeWidth={sel ? 2.4 : 1.4}
                />
                <text x={COL.step + 12} y={y - 6} fontSize={11.5} fill={GRAPH_COLORS.text}>
                  {short(s.label, 36)}
                </text>
                <text x={COL.step + 12} y={y + 12} fontSize={10} fill={GRAPH_COLORS.muted}>
                  {s.kind} · {s.action}
                  {s.verdict !== "pass" ? ` · ${s.verdict.toUpperCase()}` : ""}
                </text>
              </g>
              <path
                d={`M ${COL.step + 250} ${y} L ${COL.control} ${y}`}
                stroke={tone}
                strokeOpacity={0.7}
                strokeWidth={1.6}
                fill="none"
                strokeDasharray={s.kind === "attack" ? "5 4" : undefined}
              />
              <rect
                x={COL.control}
                y={y - 20}
                width={190}
                height={40}
                rx={8}
                fill={GRAPH_COLORS.scopeFill}
                stroke={GRAPH_COLORS.dormant}
              />
              <text x={COL.control + 95} y={y - 2} textAnchor="middle" fontSize={11} fill={GRAPH_COLORS.text}>
                {short(control, 26)}
              </text>
              <text
                x={COL.control + 95}
                y={y + 12}
                textAnchor="middle"
                fontSize={9}
                fill={GRAPH_COLORS.muted}
              >
                responsible control
              </text>
              <path
                d={`M ${COL.control + 190} ${y} L ${COL.outcome} ${y}`}
                stroke={executed && s.kind === "attack" ? "#ff6b7a" : GRAPH_COLORS.dormant}
                strokeWidth={1.6}
                fill="none"
              />
              <rect
                x={COL.outcome}
                y={y - 18}
                width={190}
                height={36}
                rx={8}
                fill={GRAPH_COLORS.deepFill}
                stroke={
                  executed && s.kind === "attack"
                    ? "#ff6b7a"
                    : executed
                      ? GRAPH_COLORS.allow
                      : GRAPH_COLORS.dormant
                }
                strokeWidth={executed ? 1.8 : 1}
              />
              <text
                x={COL.outcome + 95}
                y={y + 4}
                textAnchor="middle"
                fontSize={10.5}
                fill={GRAPH_COLORS.text}
              >
                {short(outcomeText(s), 30)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
