import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { hasConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

import { ConnectConnectionForm, ConnectionCard } from "./StripeControls";
import { toDisplayStatus, type StripeConnectionRow } from "./status";

export const metadata: Metadata = { title: "Stripe connector" };

export default async function StripeIntegrationPage() {
  const { identity, context } = await createRepositoriesForCurrentTenant("/app/integrations/stripe");
  const canAdmin = ["admin", "owner"].includes(identity.role);

  const { data: connections } = await context.supabase
    .from("connector_connections")
    .select("id, name, status, config, last_verified_at")
    .eq("connector_id", "stripe")
    .order("created_at", { ascending: false });

  const rows: StripeConnectionRow[] = await Promise.all(
    (connections ?? []).map(async (c) => {
      const config = (c.config as Record<string, unknown> | null) ?? {};
      const mode = config.mode === "test" || config.mode === "live" ? config.mode : null;
      const hasSecret = await hasConnectorSecret(c.id, "api_key");
      return {
        id: c.id,
        name: c.name,
        mode,
        hasSecret,
        lastVerifiedAt: c.last_verified_at,
        displayStatus: toDisplayStatus(c.status, hasSecret, c.last_verified_at),
      };
    }),
  );

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Stripe"
        description="Retrieve payments and customers, list charges, and issue refunds — a fixed, audited set of operations against Stripe's own API."
        secondaryAction={{ label: "View docs", href: "/docs/connectors/stripe" }}
      />

      <details className="group rounded-[10px] border border-line bg-paper px-3.5 py-2.5">
        <summary className="cursor-pointer text-[13px] font-medium text-ink-soft marker:content-none">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block transition-transform group-open:rotate-90">›</span>
            Security details
          </span>
        </summary>
        <p className="mt-2 text-[13px] text-ink-soft">
          Your secret key is stored in Supabase Vault and resolved only at the moment a connector dispatches
          an authorized request — it is never returned to this browser or logged. Prefer a{" "}
          <a
            href="https://docs.stripe.com/keys#limit-access"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            restricted key
          </a>{" "}
          scoped to only the permissions below (Payment Intents: read, Customers: read, Charges: read,
          Refunds: write) over a broad secret key. A refund always requires the financial-impact approval
          rule, unconditionally — the payment ID and amount in a refund request come from the agent&apos;s own
          request and are checked against the task&apos;s contract before Authority ever builds the Stripe
          request.
        </p>
      </details>

      {canAdmin ? <ConnectConnectionForm /> : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="token"
          heading="No connections yet"
          description={
            canAdmin
              ? "Connect a Stripe account above to get started."
              : "An admin has not connected Stripe yet."
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
