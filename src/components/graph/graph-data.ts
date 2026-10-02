/**
 * Shared color tokens for the dark-theme app graph visuals. The radial
 * authority-graph geometry that used to live alongside this (AGENT,
 * CAPABILITY_PATHS, etc.) was removed with the old marketing homepage graph
 * (design/frontend-simplification) — its replacement lives under
 * `src/components/marketing/graph/` with its own, marketing-palette data.
 * `GRAPH_COLORS` itself is kept here because the Validation Lab's
 * AttackGraph still renders against the authenticated app's dark theme.
 */

export const GRAPH_COLORS = {
  allow: "#42e7a5",
  edge: "#55d8ff",
  dormant: "#3d494d",
  muted: "#869398",
  fade: "#b8707a",
  text: "#dfe2ec",
  nodeFill: "#0b111b",
  scopeFill: "#0e1623",
  deepFill: "#070b11",
} as const;
