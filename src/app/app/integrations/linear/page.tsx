import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { hasConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

import { ConnectConnectionForm, ConnectionCard } from "./LinearControls";
import { toDisplayStatus, type LinearConnectionRow } from "./status";

export const metadata: Metadata = { title: "Linear connector" };

export default async function LinearIntegrationPage() {
  const { identity, context } = await createRepositoriesForCurrentTenant("/app/integrations/linear");
  const canAdmin = ["admin", "owner"].includes(identity.role);

  const { data: connections } = await context.supabase
    .from("connector_connections")
    .select("id, name, status, last_verified_at")
    .eq("connector_id", "linear")
    .order("created_at", { ascending: false });

  const rows: LinearConnectionRow[] = await Promise.all(
    (connections ?? []).map(async (c) => {
      const hasSecret = await hasConnectorSecret(c.id, "api_key");
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
        title="Linear"
        description="List and create issues on a team, and look up one by id — a fixed, audited set of operations against Linear's own GraphQL API."
        secondaryAction={{ label: "View docs", href: "/docs/connectors/linear" }}
      />

      <details className="group rounded-[10px] border border-line bg-paper px-3.5 py-2.5">
        <summary className="cursor-pointer text-[13px] font-medium text-ink-soft marker:content-none">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block transition-transform group-open:rotate-90">›</span>
            Security details
          </span>
        </summary>
        <p className="mt-2 text-[13px] text-ink-soft">
          Your personal API key is stored in Supabase Vault and resolved only at the moment a connector
          dispatches an authorized request — it is never returned to this browser or logged. A key acts as the
          Linear user who created it: it can only see and change what that user themself can.
        </p>
      </details>

      {canAdmin ? <ConnectConnectionForm /> : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="token"
          heading="No connections yet"
          description={
            canAdmin
              ? "Connect a Linear workspace above to get started."
              : "An admin has not connected Linear yet."
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
