import Link from "next/link";

import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPill, type StatusTone } from "@/components/ui/StatusPill";
import { CONNECTOR_CATALOG } from "@/lib/connectors/catalog";
import { loadGithubOverview } from "@/lib/github/read-model";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

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

interface RawConnectionRow {
  id: string;
  name: string;
  status: string;
}

function toConnectionRows(rows: RawConnectionRow[] | null, label: string, href: string): ConnectionRow[] {
  return (rows ?? []).map((c) => ({ id: c.id, name: `${label} · ${c.name}`, status: c.status, href }));
}

export default async function IntegrationsPage() {
  const { context } = await createRepositoriesForCurrentTenant("/app/integrations");

  const [
    { installation },
    customApiResult,
    stripeResult,
    slackResult,
    gmailResult,
    postgresResult,
    linearResult,
    notionResult,
  ] = await Promise.all([
    loadGithubOverview(context.supabase),
    context.supabase
      .from("connector_connections")
      .select("id, name, status")
      .like("connector_id", "custom\\_%")
      .neq("status", "disconnected")
      .order("created_at", { ascending: false }),
    context.supabase
      .from("connector_connections")
      .select("id, name, status")
      .eq("connector_id", "stripe")
      .neq("status", "disconnected")
      .order("created_at", { ascending: false }),
    context.supabase
      .from("connector_connections")
      .select("id, name, status")
      .eq("connector_id", "slack")
      .neq("status", "disconnected")
      .order("created_at", { ascending: false }),
    context.supabase
      .from("connector_connections")
      .select("id, name, status")
      .eq("connector_id", "gmail")
      .neq("status", "disconnected")
      .order("created_at", { ascending: false }),
    context.supabase
      .from("connector_connections")
      .select("id, name, status")
      .like("connector_id", "postgres\\_%")
      .neq("status", "disconnected")
      .order("created_at", { ascending: false }),
    context.supabase
      .from("connector_connections")
      .select("id, name, status")
      .eq("connector_id", "linear")
      .neq("status", "disconnected")
      .order("created_at", { ascending: false }),
    context.supabase
      .from("connector_connections")
      .select("id, name, status")
      .eq("connector_id", "notion")
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
    ...toConnectionRows(customApiResult.data, "Custom API", "/app/integrations/custom-api"),
    ...toConnectionRows(stripeResult.data, "Stripe", "/app/integrations/stripe"),
    ...toConnectionRows(slackResult.data, "Slack", "/app/integrations/slack"),
    ...toConnectionRows(gmailResult.data, "Gmail", "/app/integrations/gmail"),
    ...toConnectionRows(postgresResult.data, "PostgreSQL", "/app/integrations/postgres"),
    ...toConnectionRows(linearResult.data, "Linear", "/app/integrations/linear"),
    ...toConnectionRows(notionResult.data, "Notion", "/app/integrations/notion"),
  ];

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Connections"
        description="Connect the services agents may access through Authority."
        secondaryAction={{ label: "Connector docs", href: "/docs/connectors" }}
      />

      <section aria-labelledby="connector-catalog" className="flex flex-col gap-3">
        <h2 id="connector-catalog" className="text-[15px] font-semibold text-ink">
          Connectors
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CONNECTOR_CATALOG.map((entry) => {
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
