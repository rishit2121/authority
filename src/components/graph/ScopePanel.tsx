import { GRAPH_COLORS, type ScopePanel as ScopePanelSpec } from "./graph-data";

const MONO = "var(--font-space-mono), monospace";
const ROW_HEIGHT = 22;

interface ScopePanelProps {
  scope: ScopePanelSpec;
  visible: boolean;
  /** Brightened while this step's edge is in the spotlight. */
  emphasis?: boolean;
  animate: boolean;
}

/**
 * The resource slice a capability actually covers — the granted row plus the
 * neighbouring rows it deliberately excludes.
 */
export function ScopePanel({ scope, visible, emphasis = false, animate }: ScopePanelProps) {
  return (
    <g
      style={{
        opacity: visible ? (emphasis ? 1 : 0.85) : 0,
        transition: animate ? "opacity 500ms ease" : undefined,
      }}
    >
      {scope.rows.map((row, index) => {
        const y = scope.y + index * ROW_HEIGHT;
        const inset = row.granted ? 0 : 8;

        return (
          <g key={row.text}>
            <rect
              x={scope.x + inset}
              y={y}
              width={scope.width - inset}
              height={ROW_HEIGHT - 4}
              rx={4}
              fill={row.granted ? GRAPH_COLORS.scopeFill : GRAPH_COLORS.deepFill}
              fillOpacity={row.granted ? 1 : 0.55}
              stroke={row.granted ? GRAPH_COLORS.allow : GRAPH_COLORS.dormant}
              strokeWidth={row.granted && emphasis ? 1.4 : row.granted ? 1 : 0.8}
            />
            <text
              x={scope.x + inset + 8}
              y={y + 12.5}
              fontFamily={MONO}
              fontSize={row.granted ? 8 : 7}
              fontWeight={row.granted ? 700 : 400}
              fill={row.granted ? GRAPH_COLORS.allow : GRAPH_COLORS.muted}
            >
              {row.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}
