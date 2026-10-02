import Link from "next/link";

import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPill, type StatusTone } from "@/components/ui/StatusPill";
import { loadGithubOverview } from "@/lib/github/read-model";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  /** null = not yet built in this deployment; renders "Coming soon" with no link. */
  href: string | null;
  logo: { src: string; alt: string };
}

/**
 * The full connector catalog, including entries with no implementation yet
 * in this deployment. `href: null` is the only thing that distinguishes a
 * "Coming soon" card from a real one — there is no separate "available"
 * flag to keep in sync with it.
 */
const CATALOG: CatalogEntry[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Install the GitHub App, allow repositories, and bind tasks to them.",
    href: "/app/integrations/github",
    logo: { src: "/logos/github.svg", alt: "" },
  },
  {
    id: "custom-api",
    name: "Custom API",
    description: "Connect any HTTPS API your tenant controls and publish schema-constrained operations.",
    href: "/app/integrations/custom-api",
    logo: { src: "/logos/custom-api.svg", alt: "" },
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Retrieve payments and customers, and issue refunds.",
    href: null,
    logo: { src: "/logos/stripe.svg", alt: "" },
  },
  {
    id: "slack",
    name: "Slack",
    description: "Post messages and list channels in a connected workspace.",
    href: null,
    logo: { src: "/logos/slack.svg", alt: "" },
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Send email from a connected Google account.",
    href: null,
    logo: { src: "/logos/gmail.svg", alt: "" },
  },
  {
    id: "postgresql",
    name: "PostgreSQL",
    description: "Run named, parameterized queries against your own database.",
    href: null,
    logo: { src: "/logos/postgresql.svg", alt: "" },
  },
];

const CONNECTION_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  suspended: "Suspended",
  permission_drift: "Needs attention",
  needs_attention: "Needs attention",
};

const CONNECTION_STATUS_TONE: Record<string, StatusTone> = {
  active: "positive",
  suspended: "attention",
  permission_drift: "negative",
  needs_attention: "negative",
};

interface ConnectionRow {
  id: string;
  name: string;
  status: string;
  href: string;
}

export default async function IntegrationsPage() {
  const { context } = await createRepositoriesForCurrentTenant("/app/integrations");

  const [{ installation }, customApiResult] = await Promise.all([
    loadGithubOverview(context.supabase),
    context.supabase
      .from("connector_connections")
      .select("id, name, status")
      .like("connector_id", "custom\\_%")
      .neq("status", "disconnected")
      .order("created_at", { ascending: false }),
  ]);

  const connections: ConnectionRow[] = [
    ...(installation
      ? [
          {
            id: `github-${installation.id}`,
            name: `GitHub · ${installation.accountLogin}`,
            status: installation.status,
            href: "/app/integrations/github",
          },
        ]
      : []),
    ...(customApiResult.data ?? []).map((c) => ({
      id: c.id,
      name: `Custom API · ${c.name}`,
      status: c.status,
      href: "/app/integrations/custom-api",
    })),
  ];

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Integrations"
        description="Connect the services agents may access through Authority."
      />

      <section aria-labelledby="connector-catalog" className="flex flex-col gap-3">
        <h2 id="connector-catalog" className="text-[15px] font-semibold text-ink">
          Connectors
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CATALOG.map((entry) => {
            const card = (
              <>
                <div className="flex items-center justify-between gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a small, locally bundled, static brand mark; next/image's overhead buys nothing here. */}
                  <img
                    src={entry.logo.src}
                    alt={entry.logo.alt}
                    width={36}
                    height={36}
                    className="shrink-0"
                  />
                  {entry.href ? (
                    <Icon name="arrow_forward" size={16} className="text-ink-soft" />
                  ) : (
                    <StatusPill tone="muted">Coming soon</StatusPill>
                  )}
                </div>
                <h3 className="mt-3 text-[15px] font-semibold text-ink">{entry.name}</h3>
                <p className="mt-1 text-[13px] text-ink-soft">{entry.description}</p>
              </>
            );
            const className =
              "flex flex-col rounded-[14px] border border-line bg-paper-raised p-6 transition-colors" +
              (entry.href ? " hover:bg-black/[0.02]" : " opacity-70");
            return entry.href ? (
              <Link
                key={entry.id}
                href={entry.href}
                data-testid={`${entry.id}-integration-link`}
                className={className}
              >
                {card}
              </Link>
            ) : (
              <div key={entry.id} data-testid={`${entry.id}-integration-coming-soon`} className={className}>
                {card}
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="connections" className="flex flex-col gap-3">
        <h2 id="connections" className="text-[15px] font-semibold text-ink">
          Connections
        </h2>
        {connections.length === 0 ? (
          <EmptyState
            icon="token"
            heading="No connections yet"
            description="Choose a connector above to get started."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {connections.map((connection) => (
              <Link
                key={connection.id}
                href={connection.href}
                className="flex items-center justify-between rounded-[10px] border border-line bg-paper-raised p-5 transition-colors hover:bg-black/[0.02]"
              >
                <span className="text-[14px] font-medium text-ink">{connection.name}</span>
                <span className="flex items-center gap-3">
                  <StatusPill tone={CONNECTION_STATUS_TONE[connection.status] ?? "muted"}>
                    {CONNECTION_STATUS_LABEL[connection.status] ?? connection.status}
                  </StatusPill>
                  <Icon name="arrow_forward" size={16} className="text-ink-soft" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
