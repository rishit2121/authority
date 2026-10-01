"use client";

import { useEffect, useState } from "react";

import {
  AGENT_BOX,
  AGENT_NAME,
  SERVICES,
  TASK_BOX,
  TASK_LABEL,
  TASK_TEXT,
  VIEWBOX,
  type Box,
  type ServiceId,
} from "./hero-graph-data";
import { HeroGraphDescription } from "./HeroGraphDescription";
import { useHeroGraphSequence } from "./useHeroGraphSequence";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  return reduced;
}

function boxCenter(box: Box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** Where a ray from `box`'s center toward `target` exits `box`'s own boundary. */
function rectEdgePoint(box: Box, target: { x: number; y: number }) {
  const center = boxCenter(box);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const halfW = box.w / 2;
  const halfH = box.h / 2;
  const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function pct(value: number, of: number) {
  return `${(value / of) * 100}%`;
}

function serviceById(id: ServiceId) {
  return SERVICES.find((s) => s.id === id)!;
}

function PauseControl({
  paused,
  onToggle,
  className = "",
}: {
  paused: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-full border border-line-strong bg-paper-raised px-2.5 py-1 text-[10px] font-medium text-ink-soft opacity-0 transition-opacity duration-150 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 ${className}`}
    >
      {paused ? "Resume animation" : "Pause animation"}
    </button>
  );
}

export function HeroAuthorityGraph() {
  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const { phase } = useHeroGraphSequence(paused, reducedMotion);

  const allowing = phase === "allow" || phase === "retract";
  const retracting = phase === "retract";
  const revoked = phase === "revoked";
  const agentStatus =
    phase === "idle" ? "Waiting for task" : revoked ? "Permissions revoked" : "4 scoped actions";

  const agentCenter = boxCenter(AGENT_BOX);
  const taskCenter = boxCenter(TASK_BOX);
  const taskStart = rectEdgePoint(TASK_BOX, agentCenter);
  const taskEnd = rectEdgePoint(AGENT_BOX, taskCenter);

  const slack = serviceById("slack");
  const slackCenter = boxCenter(slack.box);
  const agentToSlackStart = rectEdgePoint(AGENT_BOX, slackCenter);
  const slackFacingAgent = rectEdgePoint(slack.box, agentCenter);
  const denialStop = lerp(agentToSlackStart, slackFacingAgent, 0.4);

  return (
    <figure
      className="relative w-full select-none"
      role="group"
      aria-label="Authority field, animated"
      aria-describedby="hero-graph-description"
    >
      <HeroGraphDescription />

      {/* Desktop/tablet: the full radial layout, centered in a dedicated visual wrapper so the
          Agent — not the task card — sits at the composition's visual center. Below md,
          text-bearing cards at this density stop being legible, so mobile gets its own simple
          vertical stack instead (below). This SVG contains only functional connectors — no
          decorative field lines. Those live in the separate, page-level MarketingFieldLines
          component behind the whole section. */}
      <div className="group relative hidden min-h-[580px] w-full place-items-center md:grid">
        {!reducedMotion && (
          <PauseControl
            paused={paused}
            onToggle={() => setPaused((p) => !p)}
            className="absolute right-3 top-3 z-10"
          />
        )}

        <div
          className="relative mx-auto w-full max-w-[720px]"
          style={{ aspectRatio: `${VIEWBOX.width} / ${VIEWBOX.height}` }}
        >
          <svg
            viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
            className="absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            <defs>
              <marker id="taskArrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 Z" fill="#121410" />
              </marker>
              <marker id="allowArrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 Z" fill="#087F69" />
              </marker>
            </defs>

            {/* Dormant structural edges — always present, clearly visible as the graph's own
                connectors (distinct from the much fainter, color-stable decorative background
                lines behind the whole section). */}
            {SERVICES.map((service) => {
              const target = boxCenter(service.box);
              const start = rectEdgePoint(AGENT_BOX, target);
              const end = rectEdgePoint(service.box, agentCenter);
              return (
                <line
                  key={`rest-${service.id}`}
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke="rgba(18, 20, 16, 0.25)"
                  strokeWidth="1.25"
                />
              );
            })}

            {/* Allowed overlays — PostgreSQL, Stripe, Gmail. */}
            {SERVICES.filter((s) => s.allowed).map((service) => {
              const target = boxCenter(service.box);
              const start = rectEdgePoint(AGENT_BOX, target);
              const end = rectEdgePoint(service.box, agentCenter);
              return (
                <line
                  key={`allow-${service.id}`}
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke="#087F69"
                  strokeWidth="1.8"
                  pathLength={1}
                  markerEnd={allowing && !retracting ? "url(#allowArrow)" : undefined}
                  className={`edge-path edge-animated ${allowing ? "edge-path-drawn" : ""} ${retracting ? "edge-retracting" : ""}`}
                  style={{ opacity: revoked ? 0 : allowing ? 1 : 0 }}
                />
              );
            })}

            {/* Denied overlay — Slack, a short dashed segment stopping well before the node. */}
            <line
              x1={agentToSlackStart.x}
              y1={agentToSlackStart.y}
              x2={denialStop.x}
              y2={denialStop.y}
              stroke="#B5524F"
              strokeWidth="1.5"
              strokeDasharray="4 5"
              pathLength={1}
              className={`edge-path edge-animated ${allowing ? "edge-path-drawn" : ""} ${retracting ? "edge-retracting" : ""}`}
              style={{ opacity: revoked ? 0 : allowing ? 1 : 0 }}
            />
            <circle
              cx={denialStop.x}
              cy={denialStop.y}
              r="3.5"
              fill="#B5524F"
              style={{ opacity: revoked ? 0 : allowing ? 1 : 0, transition: "opacity 300ms ease" }}
            />

            {/* Task → Agent — static, structural, always present. */}
            <line
              x1={taskStart.x}
              y1={taskStart.y}
              x2={taskEnd.x}
              y2={taskEnd.y}
              stroke="#121410"
              strokeWidth="1.25"
              markerEnd="url(#taskArrow)"
            />
          </svg>

          {/* HTML node cards, on top of the SVG. Real boxes with real text — not detached labels. */}
          <div className="absolute inset-0">
            {/* Blocked marker + label, near the denial stop point. */}
            <span
              className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-medium text-denied transition-opacity duration-300"
              style={{
                left: pct(denialStop.x, VIEWBOX.width),
                top: pct(denialStop.y - 14, VIEWBOX.height),
                opacity: revoked ? 0 : allowing ? 1 : 0,
              }}
            >
              Blocked
            </span>

            {/* Static "minimum scope" pill, above the Agent — not on the connector line itself. */}
            <span
              className="absolute -translate-x-1/2 whitespace-nowrap rounded-full border border-line-strong bg-paper-raised px-2.5 py-1 text-[10px] uppercase tracking-wide text-ink-soft"
              style={{
                left: pct(agentCenter.x, VIEWBOX.width),
                top: pct(AGENT_BOX.y - 16, VIEWBOX.height),
                transform: "translate(-50%, -100%)",
              }}
            >
              Minimum scope · 3 tools · 4 actions
            </span>

            {/* Task card. */}
            <div
              className="absolute flex flex-col justify-center gap-0.5 rounded-xl border border-line bg-paper-raised px-4 shadow-[0_8px_24px_rgba(18,20,16,0.05)]"
              style={{
                left: pct(TASK_BOX.x, VIEWBOX.width),
                top: pct(TASK_BOX.y, VIEWBOX.height),
                width: pct(TASK_BOX.w, VIEWBOX.width),
                height: pct(TASK_BOX.h, VIEWBOX.height),
              }}
            >
              <span className="font-mono-code text-[11px] tracking-wide text-ink-soft">{TASK_LABEL}</span>
              <span className="text-[14px] leading-snug text-ink">{TASK_TEXT}</span>
            </div>

            {/* Agent node — the most prominent element on the graph, and its visual center. */}
            <div
              className="absolute flex flex-col items-center justify-center gap-0.5 rounded-[14px] bg-ink px-3 text-center"
              style={{
                left: pct(AGENT_BOX.x, VIEWBOX.width),
                top: pct(AGENT_BOX.y, VIEWBOX.height),
                width: pct(AGENT_BOX.w, VIEWBOX.width),
                height: pct(AGENT_BOX.h, VIEWBOX.height),
              }}
            >
              <span className="font-mono-code text-[10px] uppercase tracking-wider text-paper-raised/70">
                Agent
              </span>
              <span className="text-[15px] font-medium text-paper-raised">{AGENT_NAME}</span>
              <span className="text-[11px] text-paper-raised/80">{agentStatus}</span>
            </div>

            {/* Service cards. */}
            {SERVICES.map((service) => (
              <div
                key={service.id}
                className="absolute flex flex-col justify-center gap-0.5 rounded-xl px-3.5"
                style={{
                  left: pct(service.box.x, VIEWBOX.width),
                  top: pct(service.box.y, VIEWBOX.height),
                  width: pct(service.box.w, VIEWBOX.width),
                  height: pct(service.box.h, VIEWBOX.height),
                  background: service.allowed ? "rgba(250, 249, 244, 0.96)" : "rgba(250, 249, 244, 0.7)",
                  border: service.allowed ? "1px solid rgba(8, 127, 105, 0.36)" : "1px solid #D3D2C8",
                  boxShadow: service.allowed ? "0 8px 24px rgba(18, 20, 16, 0.05)" : "none",
                  opacity: service.allowed ? 1 : 0.72,
                }}
              >
                <span
                  className="flex items-center gap-1.5 text-[13px] font-medium"
                  style={{ color: service.allowed ? "#121410" : "#5F655E" }}
                >
                  {service.allowed ? (
                    <span aria-hidden="true" className="text-[8px] text-signal">
                      ●
                    </span>
                  ) : null}
                  {service.label}
                </span>
                {service.lines.map((line) => (
                  <span key={line} className="text-[11.5px] leading-snug text-ink-soft">
                    {line}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: a simple vertical stack. GitHub is omitted per spec; Postgres/Stripe/Gmail stack
          below the agent, Slack sits at the bottom with its own denied treatment. */}
      <div className="group relative flex min-h-[430px] flex-col items-center gap-3 md:hidden">
        {!reducedMotion && (
          <PauseControl
            paused={paused}
            onToggle={() => setPaused((p) => !p)}
            className="absolute right-0 top-0 z-10"
          />
        )}

        <div className="w-full max-w-xs rounded-xl border border-line bg-paper-raised px-4 py-3 shadow-[0_8px_24px_rgba(18,20,16,0.05)]">
          <div className="font-mono-code text-[11px] tracking-wide text-ink-soft">{TASK_LABEL}</div>
          <div className="text-[14px] leading-snug text-ink">{TASK_TEXT}</div>
        </div>

        <span className="rounded-full border border-line-strong bg-paper-raised px-2.5 py-1 text-[10px] uppercase tracking-wide text-ink-soft">
          Minimum scope · 3 tools · 4 actions
        </span>

        <div className="flex w-full max-w-xs flex-col items-center justify-center gap-0.5 rounded-[14px] bg-ink px-4 py-3 text-center">
          <span className="font-mono-code text-[10px] uppercase tracking-wider text-paper-raised/70">
            Agent
          </span>
          <span className="text-[15px] font-medium text-paper-raised">{AGENT_NAME}</span>
          <span className="text-[11px] text-paper-raised/80">{agentStatus}</span>
        </div>

        <div aria-hidden="true" className="h-4 w-px bg-line-strong" />

        <div className="flex w-full max-w-xs flex-col gap-2">
          {SERVICES.filter((s) => s.allowed).map((service) => (
            <div
              key={service.id}
              className="flex flex-col justify-center gap-0.5 rounded-xl px-3.5 py-2.5"
              style={{
                background: "rgba(250, 249, 244, 0.96)",
                border: "1px solid rgba(8, 127, 105, 0.36)",
                boxShadow: "0 8px 24px rgba(18, 20, 16, 0.05)",
              }}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                <span aria-hidden="true" className="text-[8px] text-signal">
                  ●
                </span>
                {service.label}
              </span>
              {service.lines.map((line) => (
                <span key={line} className="text-[11.5px] leading-snug text-ink-soft">
                  {line}
                </span>
              ))}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2" style={{ opacity: revoked ? 0.4 : 1 }}>
          <div aria-hidden="true" className="h-4 w-px border-l border-dashed border-denied" />
          <span className="text-[11px] font-medium text-denied">{allowing ? "Blocked" : " "}</span>
        </div>

        <div
          className="flex w-full max-w-xs flex-col justify-center gap-0.5 rounded-xl px-3.5 py-2.5"
          style={{ background: "rgba(250, 249, 244, 0.7)", border: "1px solid #D3D2C8", opacity: 0.72 }}
        >
          <span className="text-[13px] font-medium text-ink-soft">Slack</span>
          <span className="text-[11.5px] leading-snug text-ink-soft">Outside task scope</span>
        </div>
      </div>
    </figure>
  );
}
