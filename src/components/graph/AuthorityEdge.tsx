import { GRAPH_COLORS } from "./graph-data";
import type { EdgeState, UnauthorizedState } from "./useAuthoritySequence";

interface AuthorityEdgeProps {
  path: string;
  state: EdgeState;
  animate: boolean;
}

/** `dim` keeps the connection visible before any authority is granted. */
const OPACITY: Record<EdgeState, number> = {
  dim: 0.18,
  lit: 0.9,
  focused: 1,
  dimmed: 0.35,
  succeeded: 0.95,
  retracting: 0,
};

const WIDTH: Record<EdgeState, number> = {
  dim: 1.2,
  lit: 1.9,
  focused: 2.6,
  dimmed: 1.5,
  succeeded: 2.1,
  retracting: 1.75,
};

function strokeFor(state: EdgeState): string {
  if (state === "succeeded") return GRAPH_COLORS.allow;
  if (state === "dim") return GRAPH_COLORS.dormant;
  return GRAPH_COLORS.edge;
}

/**
 * One capability path. Every path reaches `lit` in the same instant — grants
 * are simultaneous — and only the `focused` path gets the brighter stroke.
 */
export function AuthorityEdge({ path, state, animate }: AuthorityEdgeProps) {
  const drawn = state !== "retracting";

  const classes = [
    "edge-path",
    animate ? "edge-animated" : "",
    drawn ? "edge-path-drawn" : "",
    state === "retracting" ? "edge-retracting" : "",
    state === "focused" ? "edge-glow" : "",
    state === "succeeded" ? "edge-glow-success" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <path
      d={path}
      pathLength={1}
      className={classes}
      stroke={strokeFor(state)}
      strokeWidth={WIDTH[state]}
      strokeOpacity={OPACITY[state]}
      strokeLinecap="round"
      fill="none"
      style={{
        transition: animate
          ? "stroke-width 450ms ease, stroke-opacity 450ms ease, stroke 450ms ease"
          : undefined,
      }}
    />
  );
}

/**
 * Duplicate of whichever path is focused, rendered last in the SVG so it sits
 * visually on top of anything it crosses.
 */
export function FocusOverlayEdge({
  path,
  active,
  animate,
}: {
  path: string | null;
  active: boolean;
  animate: boolean;
}) {
  if (!path) return null;

  return (
    <path
      d={path}
      className="edge-glow"
      stroke={GRAPH_COLORS.edge}
      strokeWidth={active ? 3.1 : 0}
      strokeOpacity={active ? 1 : 0}
      strokeLinecap="round"
      fill="none"
      style={{ transition: animate ? "stroke-width 420ms ease, stroke-opacity 420ms ease" : undefined }}
    />
  );
}

/** A connected tool that never receives task authority. Never animated. */
export function DormantEdge({ path }: { path: string }) {
  return (
    <path
      d={path}
      stroke={GRAPH_COLORS.dormant}
      strokeWidth={1.2}
      strokeDasharray="3 5"
      strokeOpacity={0.3}
      fill="none"
    />
  );
}

const UNAUTHORIZED_OPACITY: Record<UnauthorizedState, number> = {
  dim: 0.22,
  proposed: 0.6,
  gone: 0,
};

/**
 * The out-of-scope call: connected and neutral at rest, muted rose once
 * proposed, then faded away. No block marker, no interception drama.
 */
export function UnauthorizedEdge({
  path,
  state,
  animate,
}: {
  path: string;
  state: UnauthorizedState;
  animate: boolean;
}) {
  return (
    <path
      d={path}
      stroke={state === "dim" ? GRAPH_COLORS.dormant : GRAPH_COLORS.fade}
      strokeWidth={1.5}
      strokeDasharray="3 4"
      strokeOpacity={UNAUTHORIZED_OPACITY[state]}
      strokeLinecap="round"
      fill="none"
      style={{ transition: animate ? "stroke-opacity 700ms ease, stroke 500ms ease" : undefined }}
    />
  );
}
