import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The floating dev badge sits on top of the hero graph while previewing.
  devIndicators: false,
  // Lets the Playwright-managed test server build into its own directory
  // (see playwright.config.ts's webServer.env) instead of the default
  // `.next` -- an interactive `next dev` and a `next build && next start`
  // both running against this same checkout would otherwise race on and
  // corrupt the same build output, regardless of which port each listens
  // on. Unset for every normal `next dev`/`next build` invocation.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
