import type { Metadata } from "next";

import { Icon } from "@/components/ui/Icon";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

import { ConnectConnectionForm, ConnectionCard } from "./SlackControls";

export const metadata: Metadata = { title: "Slack connector" };

const STATUS_STYLE: Record<string, string> = {
  active: "border-allow/30 bg-allow/10 text-allow",
  suspended: "border-secondary/40 bg-secondary/10 text-secondary",
  needs_attention: "border-deny/40 bg-deny/10 text-deny",
  disconnected: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
};

export interface SlackConnectionRow {
  id: string;
  name: string;
  status: string;
  environment: string;
}

export default async function SlackIntegrationPage() {
  const { identity, context } = await createRepositoriesForCurrentTenant("/app/integrations/slack");
  const canAdmin = ["admin", "owner"].includes(identity.role);

  const { data: connections } = await context.supabase
    .from("connector_connections")
    .select("id, name, status, environment")
    .eq("connector_id", "slack")
    .order("created_at", { ascending: false });

  const rows: SlackConnectionRow[] = (connections ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    environment: c.environment,
  }));

  return (
    <div className="flex flex-col gap-space-lg">
      <header>
        <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          Slack
        </h1>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          Post a message to one named channel and list the channels your bot user can see in the connected
          workspace — a fixed, audited set of operations against Slack&apos;s own Web API.
        </p>
      </header>

      <div
        role="note"
        className="flex items-start gap-space-sm rounded-lg border border-outline-variant/30 bg-surface-container px-space-md py-2.5"
      >
        <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-outline" />
        <p className="font-body-md text-body-sm text-on-surface-variant">
          Your bot token is stored in Supabase Vault and resolved only at the moment a connector dispatches an
          authorized request — it is never returned to this browser or logged. Create a bot token (
          <code className="font-mono-code">xoxb-…</code>) with the{" "}
          <code className="font-mono-code">chat:write</code> and{" "}
          <code className="font-mono-code">channels:read</code> scopes in your Slack app&apos;s OAuth
          settings.
        </p>
      </div>

      {canAdmin ? <ConnectConnectionForm /> : null}

      {rows.length === 0 ? (
        <section
          className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-space-lg"
          data-testid="slack-not-connected"
        >
          <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
            No connections yet
          </h2>
          <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
            {canAdmin
              ? "Create a connection above, then set its bot token."
              : "An admin has not connected Slack yet."}
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-space-md">
          {rows.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              statusStyle={STATUS_STYLE[connection.status] ?? STATUS_STYLE.disconnected}
              canAdmin={canAdmin}
            />
          ))}
        </div>
      )}
    </div>
  );
}
