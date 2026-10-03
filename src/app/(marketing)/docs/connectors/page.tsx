import type { Metadata } from "next";
import Link from "next/link";

import { DocsPage, DocsSection } from "@/components/docs/DocsPage";

export const metadata: Metadata = { title: "Connector guides — Authority Docs" };

const CONNECTORS = [
  { slug: "github", name: "GitHub", blurb: "Repository operations through a least-privilege GitHub App." },
  {
    slug: "custom-api",
    name: "Custom API",
    blurb: "Any HTTPS API your tenant controls, as published operations.",
  },
  { slug: "stripe", name: "Stripe", blurb: "Payments, customers, charges, and refunds." },
  { slug: "slack", name: "Slack", blurb: "Post messages and list channels in a connected workspace." },
  { slug: "gmail", name: "Gmail", blurb: "Read, search, and send mail from a connected Google account." },
  { slug: "postgres", name: "PostgreSQL", blurb: "Named, parameterized queries against your own database." },
];

export default function ConnectorsIndexPage() {
  return (
    <DocsPage
      title="Connector guides"
      description="Every connector follows the same shape: a fixed, audited set of operations, never an agent-constructed request. The credential you provide may grant more than Authority uses — each guide below says exactly what's actually callable."
    >
      <DocsSection title="Connectors">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CONNECTORS.map((c) => (
            <Link
              key={c.slug}
              href={`/docs/connectors/${c.slug}`}
              className="rounded-[10px] border border-line bg-paper-raised p-4 transition-colors hover:bg-black/[0.02]"
            >
              <span className="block text-[14px] font-medium text-ink">{c.name}</span>
              <span className="mt-1 block text-[13px] text-ink-soft">{c.blurb}</span>
            </Link>
          ))}
        </div>
      </DocsSection>
    </DocsPage>
  );
}
