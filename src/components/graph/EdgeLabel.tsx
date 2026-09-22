import { GRAPH_COLORS, type EdgeLabel as EdgeLabelSpec } from "./graph-data";

interface EdgeLabelProps {
  label: EdgeLabelSpec;
  opacity: number;
  /** The path is in the spotlight. */
  emphasis?: boolean;
  /** The call completed successfully, just before retraction. */
  success?: boolean;
  /** `fade` tints the plate a muted rose, for the proposed-but-refused call. */
  tone?: "default" | "fade";
  animate: boolean;
}

const HEIGHT = 18;

/**
 * The tool call carried by a path, rendered on the path itself with an opaque
 * plate so it stays readable where paths cross.
 */
export function EdgeLabel({
  label,
  opacity,
  emphasis = false,
  success = false,
  tone = "default",
  animate,
}: EdgeLabelProps) {
  const accent = success
    ? GRAPH_COLORS.allow
    : emphasis
      ? GRAPH_COLORS.edge
      : tone === "fade"
        ? GRAPH_COLORS.fade
        : GRAPH_COLORS.muted;

  const stroke = success
    ? GRAPH_COLORS.allow
    : emphasis
      ? GRAPH_COLORS.edge
      : tone === "fade"
        ? GRAPH_COLORS.fade
        : GRAPH_COLORS.dormant;

  return (
    <g style={{ opacity, transition: animate ? "opacity 500ms ease" : undefined }}>
      <rect
        x={label.x - label.width / 2}
        y={label.y - HEIGHT / 2}
        width={label.width}
        height={HEIGHT}
        rx={4}
        fill={GRAPH_COLORS.deepFill}
        fillOpacity={0.94}
        stroke={stroke}
        strokeOpacity={emphasis || success ? 0.55 : tone === "fade" ? 0.45 : 0.35}
        strokeWidth={0.9}
        style={{ transition: animate ? "stroke 400ms ease" : undefined }}
      />
      <text
        x={label.x}
        y={label.y + 3.2}
        textAnchor="middle"
        fontFamily="var(--font-space-mono), monospace"
        fontSize={8.5}
        fill={accent}
        style={{ transition: animate ? "fill 400ms ease" : undefined }}
      >
        {label.text}
      </text>
    </g>
  );
}
