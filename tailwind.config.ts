import type { Config } from "tailwindcss";

/**
 * Design tokens. The semantic Material-3-shaped names below (`surface`,
 * `on-surface`, `primary`, `allow`, `deny`, etc.) originally ported the dark
 * Stitch-exported palette verbatim. design/frontend-simplification's
 * authenticated-app pass re-themes the whole application by remapping what
 * these names *resolve to* — to the same warm paper/ink/signal palette the
 * marketing site already uses — rather than editing the hundreds of
 * `bg-surface-container`/`text-on-surface`/etc. className strings across
 * every page individually. That is the entire point of a semantic token
 * layer: every component that already reads "the page surface" or "the
 * primary action color" by name picks up the new look automatically.
 *
 * Deliberately NOT remapped, and still genuinely dark: `band`,
 * `graph-canvas`, `graph-node`, `graph-scope`, `code-surface`,
 * `code-surface-deep`, `timeline-surface`, `untrusted`. These back the
 * Validation Lab's attack graph and a couple of small technical-trace
 * diagrams (e.g. the GitHub execution-flow graph) that read as intentional,
 * focused dark surfaces rather than the dark theme bleeding through.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Neutral surfaces -> paper / paper-raised.
        surface: "#F3F1E9",
        background: "#F3F1E9",
        "surface-dim": "#F3F1E9",
        "surface-container-lowest": "#F3F1E9",
        "surface-container-low": "#FAF9F4",
        "surface-container": "#FAF9F4",
        "surface-container-high": "#ECEAE0",
        "surface-container-highest": "#E6E4D8",
        "surface-bright": "#FAF9F4",
        "surface-variant": "#D3D2C8",
        "inverse-surface": "#121410",
        "inverse-on-surface": "#FAF9F4",

        // Text -> ink / ink-soft.
        "on-surface": "#121410",
        "on-background": "#121410",
        "on-surface-variant": "#5F655E",

        // Hairlines -> line / line-strong.
        outline: "#AEB3A9",
        "outline-variant": "#D3D2C8",

        // Primary action -> ink (matches the marketing InkButton exactly, so every
        // existing `bg-primary text-on-primary` button becomes a near-black button
        // for free). Primary-container drives focus rings, so it stays a clearly
        // visible solid color rather than a near-invisible light tint.
        primary: "#121410",
        "on-primary": "#FAF9F4",
        "primary-container": "#087F69",
        "on-primary-container": "#FAF9F4",
        "primary-fixed": "#262923",
        "primary-fixed-dim": "#1A1C17",
        "on-primary-fixed": "#FAF9F4",
        "on-primary-fixed-variant": "#CDE9DF",
        "surface-tint": "#087F69",
        "inverse-primary": "#12A88A",

        // Secondary (was purple) -> warning/amber, the closest real semantic use left.
        secondary: "#A66B20",
        "secondary-container": "#F0DFC4",
        "on-secondary": "#FAF9F4",
        "on-secondary-container": "#A66B20",
        "secondary-fixed": "#F0DFC4",
        "secondary-fixed-dim": "#D9BD8D",
        "on-secondary-fixed": "#4A3312",
        "on-secondary-fixed-variant": "#7A5118",

        // Tertiary (was blue) -> neutral ink-soft/line; no replacement accent needed.
        tertiary: "#5F655E",
        "tertiary-container": "#D3D2C8",
        "on-tertiary": "#FAF9F4",
        "on-tertiary-container": "#121410",
        "tertiary-fixed": "#D3D2C8",
        "tertiary-fixed-dim": "#AEB3A9",
        "on-tertiary-fixed": "#121410",
        "on-tertiary-fixed-variant": "#5F655E",

        // Error -> denied/red.
        error: "#B5524F",
        "error-container": "#F3DEDC",
        "on-error": "#FAF9F4",
        "on-error-container": "#B5524F",

        // Semantic names for genuinely dark, intentionally technical surfaces — unchanged.
        band: "#0b111b",
        "graph-canvas": "#060a10",
        "graph-node": "#0b111b",
        "graph-scope": "#0e1623",
        "code-surface": "#070b12",
        "code-surface-deep": "#070b11",
        "timeline-surface": "#05080e",
        untrusted: "#140f16",

        // Status accents used throughout as `text-allow`/`bg-deny`/etc.
        allow: "#12A88A",
        deny: "#B5524F",

        /**
         * "mkt-" prefixed tokens below are the Phase 1 marketing-page design
         * system (design/frontend-simplification): a warm, light, restrained
         * palette used only by `src/components/marketing/**` and the public
         * `(marketing)` route group. Deliberately additive and namespaced
         * rather than edited in place — the unprefixed tokens above remain
         * exactly as they are for the authenticated app and the Validation
         * Lab's attack graph, neither of which this redesign touches.
         */
        "mkt-bg": "#F5F3ED",
        "mkt-surface": "#FBFAF6",
        "mkt-text": "#111318",
        "mkt-text-secondary": "#626770",
        "mkt-hairline": "rgba(17, 19, 24, 0.12)",
        "mkt-indigo": "#4F5EF7",
        "mkt-green": "#3F7D57",
        "mkt-amber": "#9A6B1E",
        "mkt-red": "#B5453D",
        "mkt-gray": "#9CA0A6",

        /**
         * Frontier-lab palette correction, scoped for now to the marketing header and
         * hero only (design/frontend-simplification hero correction) — the indigo
         * `mkt-*` tokens above are deliberately left in place and still drive every
         * other marketing section until this first fold is approved and the palette
         * propagates. Named for what they are, not where they're used, since they are
         * expected to become the real shared marketing palette afterward.
         */
        paper: "#F3F1E9",
        "paper-raised": "#FAF9F4",
        ink: "#121410",
        "ink-soft": "#5F655E",
        line: "#D3D2C8",
        "line-strong": "#AEB3A9",
        signal: "#087F69",
        "signal-bright": "#12A88A",
        "signal-soft": "#CDE9DF",
        warning: "#A66B20",
        denied: "#B5524F",
      },
      borderRadius: {
        DEFAULT: "0.125rem",
        lg: "0.25rem",
        xl: "0.5rem",
        full: "0.75rem",
      },
      spacing: {
        "space-xs": "0.25rem",
        "space-sm": "0.5rem",
        "space-md": "0.75rem",
        "space-lg": "1rem",
        "space-xl": "1.5rem",
        "space-2xl": "2.5rem",
        gutter: "1rem",
        "gutter-lg": "1.5rem",
        margin: "1rem",
        "margin-md": "1.5rem",
        "margin-lg": "2rem",
      },
      fontFamily: {
        "body-sm": ["var(--font-inter)", "system-ui", "sans-serif"],
        "body-md": ["var(--font-inter)", "system-ui", "sans-serif"],
        "body-lg": ["var(--font-inter)", "system-ui", "sans-serif"],
        "display-lg": ["var(--font-geist)", "system-ui", "sans-serif"],
        "headline-lg": ["var(--font-geist)", "system-ui", "sans-serif"],
        "headline-lg-mobile": ["var(--font-geist)", "system-ui", "sans-serif"],
        "headline-md": ["var(--font-geist)", "system-ui", "sans-serif"],
        "headline-sm": ["var(--font-geist)", "system-ui", "sans-serif"],
        "label-caps": ["var(--font-geist)", "system-ui", "sans-serif"],
        "mono-code": ["var(--font-space-mono)", "ui-monospace", "monospace"],
        "mono-token": ["var(--font-space-mono)", "ui-monospace", "monospace"],
        // Editorial display serif — hero headline only, for now (header/hero correction).
        "display-serif": ["var(--font-instrument-serif)", "Georgia", "serif"],
      },
      fontSize: {
        "body-sm": ["0.75rem", { lineHeight: "1.125rem", letterSpacing: "0em", fontWeight: "400" }],
        "body-md": ["0.875rem", { lineHeight: "1.375rem", letterSpacing: "-0.006em", fontWeight: "400" }],
        "body-lg": ["1rem", { lineHeight: "1.5rem", letterSpacing: "-0.011em", fontWeight: "400" }],
        "display-lg": ["3rem", { lineHeight: "3.5rem", letterSpacing: "-0.035em", fontWeight: "600" }],
        "headline-lg": ["2rem", { lineHeight: "2.5rem", letterSpacing: "-0.03em", fontWeight: "600" }],
        "headline-lg-mobile": [
          "1.5rem",
          { lineHeight: "2rem", letterSpacing: "-0.025em", fontWeight: "600" },
        ],
        "headline-md": ["1.375rem", { lineHeight: "1.75rem", letterSpacing: "-0.02em", fontWeight: "500" }],
        "headline-sm": ["1.125rem", { lineHeight: "1.5rem", letterSpacing: "-0.015em", fontWeight: "500" }],
        "label-caps": ["0.6875rem", { lineHeight: "0.875rem", letterSpacing: "0.06em", fontWeight: "600" }],
        "mono-code": ["0.8125rem", { lineHeight: "1.25rem", letterSpacing: "-0.01em", fontWeight: "400" }],
        "mono-token": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.04em", fontWeight: "700" }],

        // Marketing type scale (design/frontend-simplification). Desktop sizes; components
        // apply a smaller size at the `mobile` breakpoint via a responsive variant, since the
        // required mobile range (48-58px) isn't a clean fraction of the desktop range (72-96px).
        "mkt-eyebrow": ["0.8125rem", { lineHeight: "1.2rem", letterSpacing: "0.08em", fontWeight: "600" }],
        "mkt-display": ["5.5rem", { lineHeight: "1.02", letterSpacing: "-0.03em", fontWeight: "600" }],
        "mkt-display-mobile": [
          "3.25rem",
          { lineHeight: "1.05", letterSpacing: "-0.02em", fontWeight: "600" },
        ],
        "mkt-h2": ["2.75rem", { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "600" }],
        "mkt-h2-mobile": ["2rem", { lineHeight: "1.2", letterSpacing: "-0.015em", fontWeight: "600" }],
        "mkt-body": ["1.125rem", { lineHeight: "1.7", letterSpacing: "-0.006em", fontWeight: "400" }],
      },
    },
  },
  plugins: [],
};

export default config;
