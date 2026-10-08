import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { hasConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

import { ConnectConnectionForm, ConnectionCard } from "./NotionControls";
import { toDisplayStatus, type NotionConnectionRow } from "./status";

export const metadata: Metadata = { title: "Notion connector" };

export default async function NotionIntegrationPage() {
  const { identity, context } = await createRepositoriesForCurrentTenant("/app/integrations/notion");
  const canAdmin = ["admin", "owner"].includes(identity.role);

  const { data: connections } = await context.supabase
    .from("connector_connections")
    .select("id, name, status, last_verified_at")
    .eq("connector_id", "notion")
    .order("created_at", { ascending: false });

  const rows: NotionConnectionRow[] = await Promise.all(
    (connections ?? []).map(async (c) => {
      const hasSecret = await hasConnectorSecret(c.id, "bearer_token");
      return {
        id: c.id,
        name: c.name,
        hasSecret,
        lastVerifiedAt: c.last_verified_at,
        displayStatus: toDisplayStatus(c.status, hasSecret, c.last_verified_at),
      };
    }),
  );

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Notion"
        description="Read pages and databases, and create new pages — a fixed, audited set of operations against Notion's own API."
        secondaryAction={{ label: "View docs", href: "/docs/connectors/notion" }}
      />

      <details className="group rounded-[10px] border border-line bg-paper px-3.5 py-2.5">
        <summary className="cursor-pointer text-[13px] font-medium text-ink-soft marker:content-none">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block transition-transform group-open:rotate-90">›</span>
            Security details
          </span>
        </summary>
        <p className="mt-2 text-[13px] text-ink-soft">
          Your integration token is stored in Supabase Vault and resolved only at the moment a connector
          dispatches an authorized request — it is never returned to this browser or logged. The token can
          only reach pages and databases you explicitly shared with it in Notion&apos;s own
          &quot;Connections&quot; menu; sharing nothing means this connector can do nothing.
        </p>
      </details>

      {canAdmin ? <ConnectConnectionForm /> : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="token"
          heading="No connections yet"
          description={
            canAdmin
              ? "Connect a Notion integration above to get started."
              : "An admin has not connected Notion yet."
          }
        />
      ) : (
        <div className="flex flex-col gap-space-md">
          {rows.map((connection) => (
            <ConnectionCard key={connection.id} connection={connection} canAdmin={canAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}
