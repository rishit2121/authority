"use client";

import { useCallback, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { StatusDot } from "@/components/ui/StatusDot";
import { useReducedMotion } from "@/hooks/useReducedMotion";

import { AgentCore } from "./AgentCore";
import { AuthorityEdge, DormantEdge, FocusOverlayEdge, UnauthorizedEdge } from "./AuthorityEdge";
import { EdgeLabel } from "./EdgeLabel";
import { GraphDescription } from "./GraphDescription";
import { ScopePanel } from "./ScopePanel";
import { DormantToolNode, ServiceToolNode, UnauthorizedToolNode } from "./ToolNode";
import {
  AGENT,
  AUTHORIZED_SERVICES,
  CAPABILITY_PATHS,
  DORMANT_NODES,
  GRAPH_COLORS,
  ORBIT_RINGS,
  TASK,
  UNAUTHORIZED_NODE,
  VIEWBOX,
} from "./graph-data";
import { PHASE_LABELS, useAuthoritySequence, type EdgeState } from "./useAuthoritySequence";

/**
 * The hero's agent-centred authority graph.
 *
 * One enforcement cycle loops: four capabilities are minted together, each
 * takes a turn in the spotlight, the out-of-scope Slack call fades out having
 * never been granted, the successful paths flash, and everything retracts.
 *
 * The cycle pauses on pointer or keyboard interaction and only resumes when
 * the viewer says so, so it never moves on under someone inspecting it.
 * Under `prefers-reduced-motion` no timers run at all.
 */
export function AuthorityGraph() {
  const reducedMotion = useReducedMotion();
  const animate = !reducedMotion;

  const [paused, setPaused] = useState(false);
  const { phase, edgeStates, unauthorized, liveCapabilities, revokedCapabilities, replay } =
    useAuthoritySequence(animate, paused);

  // Inspecting the graph holds it in place; nothing auto-resumes.
  const holdForInspection = useCallback(() => setPaused(true), []);
  const handleReplay = useCallback(() => {
    replay();
    setPaused(false);
  }, [replay]);

  const retracted = phase === "retract";
  const focusedPath = CAPABILITY_PATHS.find((c) => edgeStates[c.id] === "focused") ?? null;

  const statesFor = (serviceId: string): EdgeState[] =>
    CAPABILITY_PATHS.filter((c) => c.serviceId === serviceId).map((c) => edgeStates[c.id]);

  return (
    <figure className="m-0">
      {/* Focusable so keyboard users can reach the region; the SVG inside is
          aria-hidden, so the sr-only description is the accessible content.
          Both pointer entry and focus hold the cycle in place. */}
      <div
        role="group"
        tabIndex={0}
        aria-label="Authority graph, animated"
        aria-describedby="authority-graph-description"
        className="relative flex min-h-[580px] w-full items-center justify-center overflow-hidden rounded-xl border border-outline-variant/20 bg-graph-canvas shadow-2xl md:h-[640px]"
        onPointerEnter={holdForInspection}
        onFocus={holdForInspection}
      >
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(#3d494d_1px,transparent_1px)] opacity-25 [background-size:20px_20px]"
          aria-hidden="true"
        />

        {/* Console chrome */}
        <div className="absolute inset-x-0 top-0 z-20 flex h-11 items-center justify-between border-b border-outline-variant/30 bg-surface-container-low/90 px-space-lg font-mono-code text-[11px] text-on-surface-variant backdrop-blur-md">
          <span className="flex items-center gap-space-sm">
            <StatusDot className="bg-primary-container" ping={animate && !paused} />
            <span className="font-medium text-on-surface">CLUSTER-ALPHA // RADIAL_AUTHORITY_GRAPH</span>
          </span>
          <span className="flex items-center gap-space-md">
            <span className="hidden font-mono-token text-allow sm:inline">[• ENFORCING_TASK_BOUNDARY]</span>
            <span className="text-outline">LATENCY: 1.1ms</span>
          </span>
        </div>

        {/* Task contract bar */}
        <div className="absolute inset-x-4 top-14 z-20 flex flex-col justify-between gap-2 rounded-lg border border-outline-variant/40 bg-surface-container/95 p-2.5 shadow-lg backdrop-blur-md md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono-token text-[10px] text-primary">
              {TASK.id}
            </span>
            <span className="truncate font-body-sm text-body-sm font-medium text-on-surface">
              {TASK.prompt}
            </span>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 font-mono-code text-[11px] text-allow">
            <StatusDot className="bg-allow" ping={animate && !paused && !retracted} />
            Active Scope: {liveCapabilities} Ephemeral Cap{liveCapabilities === 1 ? "" : "s"}
          </span>
        </div>

        <svg
          viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="authority-halo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#52d6fc" stopOpacity="0.45" />
              <stop offset="50%" stopColor="#52d6fc" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#52d6fc" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="authority-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0e1b2a" />
              <stop offset="100%" stopColor="#060b12" />
            </radialGradient>
          </defs>

          {ORBIT_RINGS.map((ring) => (
            <circle
              key={ring.r}
              cx={AGENT.x}
              cy={AGENT.y}
              r={ring.r}
              fill="none"
              stroke={GRAPH_COLORS.dormant}
              strokeDasharray={ring.dash}
              strokeOpacity={ring.opacity}
            />
          ))}

          {/* Connected, never authorized */}
          {DORMANT_NODES.map((node) => (
            <g key={node.id}>
              <DormantEdge path={node.path} />
              <DormantToolNode node={node} />
            </g>
          ))}

          {/* Proposed and refused */}
          <UnauthorizedEdge path={UNAUTHORIZED_NODE.path} state={unauthorized} animate={animate} />
          <UnauthorizedToolNode
            box={UNAUTHORIZED_NODE.box}
            service={UNAUTHORIZED_NODE.service}
            tool={UNAUTHORIZED_NODE.tool}
            state={unauthorized}
            animate={animate}
          />
          <EdgeLabel
            label={UNAUTHORIZED_NODE.label}
            opacity={unauthorized === "proposed" ? 0.7 : 0}
            tone="fade"
            animate={animate}
          />

          {/* Service plates and the resource slices their capabilities reach */}
          {AUTHORIZED_SERVICES.map((service) => {
            const states = statesFor(service.id);
            const lit = states.some((s) => s !== "dim" && s !== "retracting");
            return (
              <g key={service.id}>
                <ServiceToolNode
                  box={service.box}
                  service={service.service}
                  tools={service.tools}
                  states={states}
                  animate={animate}
                />
                <ScopePanel
                  scope={service.scope}
                  visible={lit}
                  emphasis={states.includes("focused")}
                  animate={animate}
                />
              </g>
            );
          })}

          {/* The four capabilities, granted together */}
          {CAPABILITY_PATHS.map((capability) => {
            const state = edgeStates[capability.id];
            const lit = state !== "dim" && state !== "retracting";
            return (
              <g key={capability.id}>
                <AuthorityEdge path={capability.path} state={state} animate={animate} />
                <EdgeLabel
                  label={capability.label}
                  opacity={lit ? (state === "dimmed" ? 0.5 : 1) : 0}
                  emphasis={state === "focused"}
                  success={state === "succeeded"}
                  animate={animate}
                />
              </g>
            );
          })}

          {/* Spotlight duplicate, drawn last so it layers above any crossing */}
          <FocusOverlayEdge
            path={focusedPath?.path ?? null}
            active={Boolean(focusedPath)}
            animate={animate}
          />

          <AgentCore edgeStates={edgeStates} unauthorized={unauthorized} animate={animate} />
        </svg>

        {/* Capability ledger + phase readout */}
        <div className="absolute inset-x-4 bottom-3 z-20 flex items-center justify-between gap-2">
          <span className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded border border-outline-variant/30 bg-surface-container-highest/80 px-3 py-1.5 font-mono-code text-[11px] text-on-surface-variant">
            <Icon name="lock_reset" size={14} className="text-primary" />
            <span>
              {retracted ? (
                <strong className="font-semibold text-allow">
                  {revokedCapabilities} capabilities revoked
                </strong>
              ) : (
                <strong className="font-semibold text-allow">{liveCapabilities} capabilities live</strong>
              )}
              {" · "}
              <span className="text-outline">0 standing permissions</span>
            </span>
          </span>

          <span className="hidden shrink-0 whitespace-nowrap rounded border border-outline-variant/30 bg-surface-container-highest/80 px-3 py-1.5 font-mono-code text-[11px] text-on-surface-variant lg:block">
            {PHASE_LABELS[phase]}
          </span>
        </div>
      </div>

      {/* Playback controls. Always rendered so keyboard users can reach them. */}
      <figcaption className="mt-space-md flex flex-wrap items-center justify-between gap-space-sm">
        <span className="font-mono-code text-[11px] text-outline">
          {reducedMotion
            ? "Reduced motion: showing the resolved authorization state."
            : paused
              ? "Paused while you inspect the graph."
              : "Cycling through one enforcement pass."}
        </span>

        {!reducedMotion ? (
          <span className="flex items-center gap-space-sm">
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              aria-pressed={paused}
              className="rounded border border-outline-variant/40 bg-surface-container px-3 py-1.5 font-body-sm text-[12px] text-on-surface transition-colors hover:bg-surface-container-high"
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={handleReplay}
              className="rounded border border-primary/40 bg-primary/10 px-3 py-1.5 font-body-sm text-[12px] text-primary transition-colors hover:bg-primary/20"
            >
              Replay
            </button>
          </span>
        ) : null}
      </figcaption>

      <GraphDescription />
    </figure>
  );
}
