/**
 * Decorative background for the hero: concentric, irregular contour lines
 * suggesting a bounded "authority field" around the agent. Purely
 * presentational (aria-hidden, pointer-events-none) and intentionally very
 * low contrast so it never competes with the headline. SVG + CSS only — no
 * WebGL, no external requests. The one subtle drift animation it uses is
 * neutralized globally under `prefers-reduced-motion` (see globals.css).
 */
export function AuthorityField({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1200 800"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      preserveAspectRatio="xMidYMid slice"
    >
      <g className="animate-contour-drift" stroke="#111318" strokeWidth="1" fill="none">
        <path
          d="M 600 120 C 820 120 980 260 980 400 C 980 540 820 680 600 680 C 380 680 220 540 220 400 C 220 260 380 120 600 120 Z"
          opacity="0.05"
        />
        <path
          d="M 600 180 C 770 180 900 280 900 400 C 900 520 770 620 600 620 C 430 620 300 520 300 400 C 300 280 430 180 600 180 Z"
          opacity="0.07"
        />
        <path
          d="M 600 240 C 720 240 820 310 820 400 C 820 490 720 560 600 560 C 480 560 380 490 380 400 C 380 310 480 240 600 240 Z"
          opacity="0.09"
        />
      </g>
      <g stroke="#4F5EF7" strokeWidth="1" fill="none">
        <path
          d="M 600 300 C 670 300 740 340 740 400 C 740 460 670 500 600 500 C 530 500 460 460 460 400 C 460 340 530 300 600 300 Z"
          opacity="0.10"
        />
      </g>
    </svg>
  );
}
