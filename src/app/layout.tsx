import type { Metadata, Viewport } from "next";

import { fontVariables } from "@/lib/fonts";

import "@/styles/globals.css";

export const metadata: Metadata = {
  title: {
    default: "Authority — AI Agent Runtime Authorization & Least Privilege Infrastructure",
    template: "%s · Authority",
  },
  description:
    "Authority is a runtime authorization substrate that verifies each agent action against user intent and company policy, grants the smallest temporary capability, and blocks everything else.",
};

export const viewport: Viewport = {
  themeColor: "#0a0e15",
  width: "device-width",
  initialScale: 1,
};

/**
 * Root layout owns only the document shell and fonts. Chrome differs per
 * surface — marketing gets the site header/footer, the control plane gets the
 * dashboard shell — so each route group supplies its own.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${fontVariables}`}>
      <body className="bg-surface-container-lowest font-body-md text-on-surface antialiased selection:bg-primary selection:text-on-primary">
        {children}
      </body>
    </html>
  );
}
