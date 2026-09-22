import { AGENT, CAPABILITY_PATHS, DORMANT_NODES, GRAPH_COLORS, UNAUTHORIZED_NODE } from "./graph-data";
import type { EdgeState, UnauthorizedState } from "./useAuthoritySequence";

const MONO = "var(--font-space-mono), monospace";

interface AgentCoreProps {
  edgeStates: Record<string, EdgeState>;
  unauthorized: UnauthorizedState;
  animate: boolean;
}

/** The agent: the largest node, at the centre, with one port per connection. */
export function AgentCore({ edgeStates, unauthorized, animate }: AgentCoreProps) {
  return (
    <g transform={`translate(${AGENT.x}, ${AGENT.y})`}>
      <circle
        r={AGENT.haloRadius}
        fill="url(#authority-halo)"
        className={animate ? "animate-halo" : ""}
        style={animate ? { transformOrigin: "center" } : { opacity: 0.45 }}
      />
      <circle r={AGENT.coreRadius} fill="url(#authority-core)" stroke={GRAPH_COLORS.edge} strokeWidth={2} />

      {/* Core text sits inside a ~124px safe band so it never crosses the stroke. */}
      <circle cx={0} cy={-30} r={4} fill={GRAPH_COLORS.allow} />
      <text
        x={0}
        y={-17}
        textAnchor="middle"
        fontFamily={MONO}
        fontSize={7.5}
        fontWeight={700}
        letterSpacing="0.06em"
        fill={GRAPH_COLORS.allow}
      >
        {`ACTIVE · TASK ${AGENT.taskId}`}
      </text>
      <text
        x={0}
        y={5}
        textAnchor="middle"
        fontFamily="var(--font-geist), sans-serif"
        fontSize={12}
        fontWeight={700}
        fill={GRAPH_COLORS.text}
      >
        {AGENT.name}
      </text>
      <text x={0} y={22} textAnchor="middle" fontFamily={MONO} fontSize={8.5} fill={GRAPH_COLORS.edge}>
        {AGENT.model}
      </text>

      {CAPABILITY_PATHS.map((capability) => {
        const state = edgeStates[capability.id];
        const lit = state !== "dim" && state !== "retracting";
        return (
          <circle
            key={capability.id}
            cx={capability.port.x}
            cy={capability.port.y}
            r={3}
            fill={state === "succeeded" ? GRAPH_COLORS.allow : lit ? GRAPH_COLORS.edge : GRAPH_COLORS.dormant}
            style={{ transition: animate ? "fill 400ms ease" : undefined }}
          />
        );
      })}

      {DORMANT_NODES.map((node) => (
        <circle key={node.id} cx={node.port.x} cy={node.port.y} r={3} fill={GRAPH_COLORS.dormant} />
      ))}

      <circle
        cx={UNAUTHORIZED_NODE.port.x}
        cy={UNAUTHORIZED_NODE.port.y}
        r={3}
        fill={unauthorized === "dim" ? GRAPH_COLORS.dormant : GRAPH_COLORS.fade}
        opacity={unauthorized === "gone" ? 0.4 : 1}
        style={{ transition: animate ? "opacity 500ms ease, fill 500ms ease" : undefined }}
      />
    </g>
  );
}
