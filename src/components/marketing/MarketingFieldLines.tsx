/**
 * Page-level decorative line system (design/frontend-simplification). Kept
 * completely separate from the functional graph's own SVG: these are two or
 * three broad, extremely low-contrast arcs that live behind the hero and the
 * section after it, routed through empty space so they never cross a graph
 * node or the headline. Never closed, never circular, never animated, and
 * never sharing a color scale with the graph's own connector states.
 */
export function MarketingFieldLines() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1600 1600"
      preserveAspectRatio="none"
      className="marketing-field-lines pointer-events-none absolute inset-0 z-0 h-full w-full"
    >
      {/* Upper background — stays above the headline and the task card. */}
      <path
        d="M -120 140 C 480 10, 1080 20, 1720 190"
        fill="none"
        stroke="rgba(18, 20, 16, 0.045)"
        strokeWidth="0.8"
        vectorEffect="non-scaling-stroke"
      />
      {/* Behind the bottom of the hero — stays below the lowest graph nodes. */}
      <path
        d="M -100 760 C 520 640, 1100 660, 1720 860"
        fill="none"
        stroke="rgba(8, 127, 105, 0.065)"
        strokeWidth="0.8"
        vectorEffect="non-scaling-stroke"
      />
      {/* Along the transition into the next section. */}
      <path
        d="M -120 1240 C 460 1120, 1080 1180, 1720 1340"
        fill="none"
        stroke="rgba(18, 20, 16, 0.045)"
        strokeWidth="0.8"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
