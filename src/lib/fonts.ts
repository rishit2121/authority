import localFont from "next/font/local";

/**
 * Fonts are committed to the repository (src/assets/fonts, each family with its SIL Open Font License) and
 * self-hosted by next/font/local, so a build makes no network request. Before, next/font/google downloaded them
 * from fonts.googleapis.com at build time, and CI builds failed intermittently when that fetch did.
 * Latin subsets only, at exactly the weights the site uses.
 */
export const geist = localFont({
  src: [
    { path: "../assets/fonts/geist/Geist-Regular.woff2", weight: "400", style: "normal" },
    { path: "../assets/fonts/geist/Geist-Medium.woff2", weight: "500", style: "normal" },
    { path: "../assets/fonts/geist/Geist-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../assets/fonts/geist/Geist-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-geist",
  display: "swap",
});

export const inter = localFont({
  src: [
    { path: "../assets/fonts/inter/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../assets/fonts/inter/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../assets/fonts/inter/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});

export const spaceMono = localFont({
  src: [
    { path: "../assets/fonts/space-mono/space-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../assets/fonts/space-mono/space-mono-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-space-mono",
  display: "swap",
});

/** Editorial display serif for marketing headlines only; the family exists only at weight 400. */
export const instrumentSerif = localFont({
  src: [
    {
      path: "../assets/fonts/instrument-serif/instrument-serif-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-instrument-serif",
  display: "swap",
});

export const fontVariables = `${geist.variable} ${inter.variable} ${spaceMono.variable} ${instrumentSerif.variable}`;
