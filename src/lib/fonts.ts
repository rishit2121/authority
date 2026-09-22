import { Geist, Inter, Space_Mono } from "next/font/google";

/**
 * Self-hosted at build time by next/font, replacing the export's runtime
 * requests to fonts.googleapis.com.
 */
export const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist",
  display: "swap",
});

export const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

export const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

export const fontVariables = `${geist.variable} ${inter.variable} ${spaceMono.variable}`;
