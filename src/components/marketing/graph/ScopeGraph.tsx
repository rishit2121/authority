"use client";

import { useEffect, useState } from "react";

import { AGENT, PATHS, SERVICES, VIEWBOX, type ServiceId } from "./graph-data";
import { ScopeGraphDescription } from "./ScopeGraphDescription";
import { useScopeSequence } from "./useScopeSequence";

const BOUNDARY_RADIUS = 150;

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

function nodeById(id: ServiceId) {
  return SERVICES.find((s) => s.id === id)!;
}

/** Point at distance `t` (0-1) along the line from the agent toward a node. */
function pointToward(id: ServiceId, t: number) {
  const node = nodeById(id);
  return { x: AGENT.x + (node.x - AGENT.x) * t, y: AGENT.y + (node.y - AGENT.y) * t };
}

export function ScopeGraph() {
  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const { phase, replay } = useScopeSequence(paused, reducedMotion);

  const showRequired = phase === "illuminate" || phase === "success" || phase === "retract";
  const showSuccess = phase === "success";
  const retracting = phase === "retract";
  const showRejected = phase === "illuminate" || phase === "success" || phase === "retract";
  const done = phase === "done";

  const pauseLabel = paused ? "Resume" : "Pause";

  return (
    <figure
      className="relative w-full select-none"
      role="group"
      tabIndex={-1}
      aria-label="Authority field, animated"
      aria-describedby="scope-graph-description"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <ScopeGraphDescription />

      <div className="relative w-full pb-10">
        <svg viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} className="h-auto w-full" aria-hidden="true">
          {/* Authority boundary */}
          <circle
            cx={AGENT.x}
            cy={AGENT.y}
            r={BOUNDARY_RADIUS}
            fill="none"
            stroke="#111318"
            strokeOpacity="0.12"
            strokeDasharray="3 5"
          />

          {/* Edges */}
          {PATHS.map((path) => {
            const node = nodeById(path.service);
            const isStripeSecond = path.id === "create-refund";
            const curveOffset = isStripeSecond ? 22 : path.service === "stripe" ? -22 : 0;
            const midX = (AGENT.x + node.x) / 2 + curveOffset;
            const midY = (AGENT.y + node.y) / 2 + curveOffset;

            if (path.kind === "required") {
              const active = showRequired;
              const stroke = showSuccess ? "#3F7D57" : "#4F5EF7";
              return (
                <g key={path.id} className={retracting ? "edge-retracting" : ""}>
                  <path
                    d={`M ${AGENT.x} ${AGENT.y} Q ${midX} ${midY} ${node.x} ${node.y}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth="1.5"
                    pathLength={1}
                    className={`edge-path edge-animated ${active ? "edge-path-drawn" : ""}`}
                    style={{ opacity: done ? 0 : active ? 1 : 0 }}
                  />
                </g>
              );
            }

            // Rejected (Slack): stops short, at the boundary.
            const stop = pointToward(
              path.service,
              BOUNDARY_RADIUS / Math.hypot(node.x - AGENT.x, node.y - AGENT.y),
            );
            return (
              <g
                key={path.id}
                style={{ opacity: showRejected && !done ? 1 : 0, transition: "opacity 400ms ease" }}
              >
                <line
                  x1={AGENT.x}
                  y1={AGENT.y}
                  x2={stop.x}
                  y2={stop.y}
                  stroke="#B5453D"
                  strokeWidth="1.5"
                  pathLength={1}
                  className="edge-path edge-animated edge-path-drawn"
                />
                <circle cx={stop.x} cy={stop.y} r="4" fill="#B5453D" />
              </g>
            );
          })}

          {/* Service nodes (labels are a separate HTML overlay below — SVG text scales with
            the viewBox and becomes unreadably small on narrow screens). */}
          {SERVICES.map((service) => {
            const isDim = Boolean(service.dim);
            return (
              <circle
                key={service.id}
                cx={service.x}
                cy={service.y}
                r="26"
                fill="#FBFAF6"
                stroke="#111318"
                strokeOpacity={isDim ? 0.15 : 0.3}
                strokeWidth="1.5"
              />
            );
          })}

          {/* Agent node */}
          <circle cx={AGENT.x} cy={AGENT.y} r="34" fill="#4F5EF7" opacity={phase === "evaluate" ? 0.85 : 1} />
        </svg>

        {/* HTML label overlay, positioned by percentage so text size is set in real CSS units
          and stays readable regardless of how small the SVG is scaled down on mobile. */}
        <div className="pointer-events-none absolute inset-0">
          <span
            className="absolute -translate-x-1/2 text-[12px] font-semibold text-mkt-text"
            style={{
              left: `${(AGENT.x / VIEWBOX.width) * 100}%`,
              top: `${(AGENT.y / VIEWBOX.height) * 100}%`,
              marginTop: `${(40 / VIEWBOX.width) * 100}%`,
            }}
          >
            Agent
          </span>
          {SERVICES.map((service) => {
            const isDim = Boolean(service.dim);
            return (
              <span
                key={service.id}
                className={`absolute -translate-x-1/2 text-[12px] ${isDim ? "text-mkt-gray" : "text-mkt-text"}`}
                style={{
                  left: `${(service.x / VIEWBOX.width) * 100}%`,
                  top: `${(service.y / VIEWBOX.height) * 100}%`,
                  marginTop: `${(40 / VIEWBOX.width) * 100}%`,
                }}
              >
                {service.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Human-readable labels for active paths, shown as a list beside/below the graph rather than
          crowding the SVG with tiny text. */}
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
        {PATHS.filter((p) => p.kind === "required").map((p) => (
          <span
            key={p.id}
            className="text-mkt-text-secondary transition-opacity"
            style={{ opacity: showRequired ? 1 : 0.3 }}
          >
            {p.label}
            <span className="ml-1.5 font-mono-code text-[11px] text-mkt-gray">{p.operationId}</span>
          </span>
        ))}
        <span className="text-mkt-red" style={{ opacity: showRejected && !done ? 1 : 0.3 }}>
          Send message (denied)
          <span className="ml-1.5 font-mono-code text-[11px] text-mkt-gray">slack.chat.postMessage</span>
        </span>
      </div>

      <figcaption className="mt-6 flex items-center justify-between border-t border-mkt-hairline pt-4">
        <span className="text-[13px] text-mkt-text-secondary">
          {done
            ? "0 standing permissions"
            : "Task: Refund order #4821 and email the customer a confirmation."}
        </span>
        <span className="flex items-center gap-4">
          {!reducedMotion && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              className="text-[13px] font-medium text-mkt-indigo underline-offset-2 hover:underline"
            >
              {pauseLabel}
            </button>
          )}
          {!reducedMotion && (
            <button
              type="button"
              onClick={replay}
              className="text-[13px] font-medium text-mkt-indigo underline-offset-2 hover:underline"
            >
              Replay
            </button>
          )}
        </span>
      </figcaption>
    </figure>
  );
}
