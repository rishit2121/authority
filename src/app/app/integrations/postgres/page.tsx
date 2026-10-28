import type { Metadata } from "next";
import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

import { ConnectConnectionForm, ConnectionCard } from "./PostgresControls";

export const metadata: Metadata = { title: "PostgreSQL connector" };

const STATUS_STYLE: Record<string, string> = {
  active: "border-allow/30 bg-allow/10 text-allow",
  suspended: "border-secondary/40 bg-secondary/10 text-secondary",
  needs_attention: "border-deny/40 bg-deny/10 text-deny",
  disconnected: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
};

export interface QueryRow {
  id: string;
  connectionId: string;
  querySlug: string;
  toolName: string;
  name: string;
  sqlTemplate: string;
  effect: string;
  status: string;
}

export interface ConnectionRow {
  id: string;
  connectorId: string;
  name: string;
  status: string;
  host: string | null;
  port: number | null;
  database: string | null;
  sslmode: string | null;
  queries: QueryRow[];
}

export default async function PostgresIntegrationPage() {
  const { identity, context } = await createRepositoriesForCurrentTenant("/app/integrations/postgres");
  const canAdmin = ["admin", "owner"].includes(identity.role);
  const canDevelop = ["developer", "security_admin", "admin", "owner"].includes(identity.role);

  const [{ data: connections }, { data: queries }] = await Promise.all([
    context.supabase
      .from("connector_connections")
      .select("id, connector_id, name, status, config")
      .is("archived_at", null)
      .like("connector_id", "postgres\\_%")
      .order("created_at", { ascending: false }),
    context.supabase
      .from("postgres_query_definitions")
      .select("id, connection_id, query_slug, tool_name, name, sql_template, effect, status")
      .order("created_at", { ascending: true }),
  ]);

  const rows: ConnectionRow[] = (connections ?? []).map((c) => {
    const config = (c.config as Record<string, unknown> | null) ?? {};
    return {
      id: c.id,
      connectorId: c.connector_id,
      name: c.name,
      status: c.status,
      host: typeof config.host === "string" ? config.host : null,
      port: typeof config.port === "number" ? config.port : null,
      database: typeof config.database === "string" ? config.database : null,
      sslmode: typeof config.sslmode === "string" ? config.sslmode : null,
      queries: (queries ?? [])
        .filter((q) => q.connection_id === c.id)
        .map((q) => ({
          id: q.id,
          connectionId: q.connection_id,
          querySlug: q.query_slug,
          toolName: q.tool_name,
          name: q.name,
          sqlTemplate: q.sql_template,
          effect: q.effect,
          status: q.status,
        })),
    };
  });

  return (
    <div className="flex flex-col gap-space-lg">
      <header>
        <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          PostgreSQL
        </h1>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          Every tenant&apos;s schema is different, so there is no fixed, universal operation here — a
          developer writes a named, parameterized query and an administrator publishes it, exactly like Custom
          API&apos;s operations. Published is frozen forever; a query&apos;s SQL never changes under a
          contract that already pinned it.
        </p>
        <Link
          href="/docs/connectors/postgres"
          className="mt-space-sm inline-block text-[13px] text-outline underline underline-offset-2"
        >
          View docs
        </Link>
      </header>

      <div
        role="note"
        className="flex items-start gap-space-sm rounded-lg border border-outline-variant/30 bg-surface-container px-space-md py-2.5"
      >
        <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-outline" />
        <p className="font-body-md text-body-sm text-on-surface-variant">
          Parameters bind as a native parameterized query (never string-interpolated), a declared read is
          independently rescanned for any data-modifying keyword — including inside a CTE — and every query
          runs under its own statement timeout. Unlike Custom API, private network destinations are allowed:
          your database is expected to live on one.
        </p>
      </div>

      {canAdmin ? <ConnectConnectionForm /> : null}

      {rows.length === 0 ? (
        <section
          className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-space-lg"
          data-testid="postgres-not-connected"
        >
          <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
            No connections yet
          </h2>
          <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
            {canAdmin
              ? "Create a connection above, set its credentials, then define and publish a query."
              : "An admin has not connected a database yet."}
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
              canDevelop={canDevelop}
            />
          ))}
        </div>
      )}
    </div>
  );
}
