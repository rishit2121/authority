import { GRAPH_COLORS, type DormantNode, type NodeBox } from "./graph-data";
import type { EdgeState, UnauthorizedState } from "./useAuthoritySequence";

const MONO = "var(--font-space-mono), monospace";

/** Aggregate of a service's capability paths, worst-to-best. */
function nodeOpacity(states: EdgeState[]): number {
  if (states.includes("focused") || states.includes("succeeded")) return 1;
  if (states.includes("lit")) return 1;
  if (states.includes("dimmed")) return 0.7;
  return 0.5;
}

interface ServiceToolNodeProps {
  box: NodeBox;
  service: string;
  /** One line per capability this service holds for the task. */
  tools: string[];
  /** States of this service's capability paths. */
  states: EdgeState[];
  animate: boolean;
}

/**
 * A service the task holds capabilities for. Renders one tool line per
 * capability, so Stripe reads as two grants rather than one vague link.
 */
export function ServiceToolNode({ box, service, tools, states, animate }: ServiceToolNodeProps) {
  const lit = states.some((s) => s === "lit" || s === "focused" || s === "dimmed" || s === "succeeded");
  const focused = states.includes("focused");
  const succeeded = states.every((s) => s === "succeeded");
  const accent = succeeded ? GRAPH_COLORS.allow : GRAPH_COLORS.edge;

  return (
    <g style={{ transition: animate ? "opacity 400ms ease" : undefined, opacity: nodeOpacity(states) }}>
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={6}
        fill={GRAPH_COLORS.nodeFill}
        stroke={lit ? accent : GRAPH_COLORS.dormant}
        strokeWidth={focused ? 1.8 : lit ? 1.2 : 1}
        style={{ transition: animate ? "stroke 400ms ease, stroke-width 400ms ease" : undefined }}
      />
      <circle cx={box.x + 16} cy={box.y + 19} r={3.5} fill={lit ? GRAPH_COLORS.allow : GRAPH_COLORS.muted} />
      <text
        x={box.x + 28}
        y={box.y + 23}
        fontFamily={MONO}
        fontSize={10}
        fontWeight={700}
        fill={GRAPH_COLORS.text}
      >
        {service}
      </text>
      {tools.map((tool, index) => (
        <text
          key={tool}
          x={box.x + 28}
          y={box.y + 37 + index * 13}
          fontFamily={MONO}
          fontSize={8}
          fill={lit ? accent : GRAPH_COLORS.muted}
          style={{ transition: animate ? "fill 400ms ease" : undefined }}
        >
          {tool}
        </text>
      ))}
    </g>
  );
}

/** A connected service that never receives authority for this task. */
export function DormantToolNode({ node }: { node: DormantNode }) {
  const midY = node.box.y + node.box.height / 2;

  return (
    <g opacity={0.5}>
      <rect
        x={node.box.x}
        y={node.box.y}
        width={node.box.width}
        height={node.box.height}
        rx={6}
        fill={GRAPH_COLORS.deepFill}
        stroke={GRAPH_COLORS.dormant}
        strokeDasharray="3 3"
        strokeWidth={1}
      />
      <circle cx={node.box.x + 15} cy={midY} r={3} fill={GRAPH_COLORS.muted} />
      <text
        x={node.box.x + 26}
        y={midY - 1}
        fontFamily={MONO}
        fontSize={9}
        fontWeight={600}
        fill={GRAPH_COLORS.muted}
      >
        {node.service}
      </text>
      <text x={node.box.x + 26} y={midY + 11} fontFamily={MONO} fontSize={7} fill={GRAPH_COLORS.muted}>
        NO AUTHORITY
      </text>
    </g>
  );
}

const UNAUTH_OPACITY: Record<UnauthorizedState, number> = {
  dim: 0.45,
  proposed: 0.75,
  gone: 0,
};

/** The service the agent proposed reaching and was never granted. */
export function UnauthorizedToolNode({
  box,
  service,
  tool,
  state,
  animate,
}: {
  box: NodeBox;
  service: string;
  tool: string;
  state: UnauthorizedState;
  animate: boolean;
}) {
  const midY = box.y + box.height / 2;
  const accent = state === "dim" ? GRAPH_COLORS.muted : GRAPH_COLORS.fade;

  return (
    <g style={{ opacity: UNAUTH_OPACITY[state], transition: animate ? "opacity 700ms ease" : undefined }}>
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={6}
        fill={GRAPH_COLORS.deepFill}
        stroke={accent}
        strokeOpacity={0.5}
        strokeDasharray="3 3"
        strokeWidth={1}
        style={{ transition: animate ? "stroke 500ms ease" : undefined }}
      />
      <circle cx={box.x + 16} cy={midY} r={3.5} fill={accent} />
      <text
        x={box.x + 28}
        y={midY - 2}
        fontFamily={MONO}
        fontSize={10}
        fontWeight={700}
        fill={GRAPH_COLORS.muted}
      >
        {service}
      </text>
      <text x={box.x + 28} y={midY + 11} fontFamily={MONO} fontSize={8} fill={accent}>
        {tool} — not granted
      </text>
    </g>
  );
}
