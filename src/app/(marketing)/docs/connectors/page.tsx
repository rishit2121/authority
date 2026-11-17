import type { Metadata } from "next";
import Link from "next/link";

import { DocsPage, DocsSection } from "@/components/docs/DocsPage";
import { REST_CONNECTOR_SPECS } from "@/lib/connectors/rest/providers";

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
  { slug: "linear", name: "Linear", blurb: "List and create issues on a team, and look up one by id." },
  { slug: "notion", name: "Notion", blurb: "Read pages and databases, and create new pages." },
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

      <DocsSection title={`API-key connectors (${REST_CONNECTOR_SPECS.length})`}>
        <p>
          Each of these is one declarative definition — a fixed host, how its key is sent, and a short list of
          audited operations — executed by one shared connector, so what Authority authorizes and what it
          sends can&apos;t drift apart. They are checked against each provider&apos;s published API reference
          and a mock of it, not yet against live accounts.
        </p>
        {[...new Set(REST_CONNECTOR_SPECS.map((s) => s.category))].sort().map((category) => (
          <div key={category} className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold text-ink">{category}</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {REST_CONNECTOR_SPECS.filter((s) => s.category === category).map((s) => (
                <Link
                  key={s.id}
                  href={`/docs/connectors/${s.id}`}
                  className="rounded-[10px] border border-line bg-paper-raised p-3 transition-colors hover:bg-black/[0.02]"
                >
                  <span className="block text-[13px] font-medium text-ink">{s.name}</span>
                  <span className="mt-0.5 block text-[12px] text-ink-soft">{s.description}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </DocsSection>
    </DocsPage>
  );
}
