import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

import { ConnectConnectionForm, ConnectionCard } from "./CustomApiControls";

export const metadata: Metadata = { title: "Custom API connector" };

const STATUS_STYLE: Record<string, string> = {
  active: "border-allow/30 bg-allow/10 text-allow",
  suspended: "border-secondary/40 bg-secondary/10 text-secondary",
  needs_attention: "border-deny/40 bg-deny/10 text-deny",
  disconnected: "border-outline-variant/40 bg-surface-container-high text-on-surface-variant",
};

export interface OperationRow {
  id: string;
  connectionId: string;
  operationSlug: string;
  toolName: string;
  name: string;
  method: string;
  pathTemplate: string;
  effect: string;
  authType: string;
  status: string;
}

export interface ConnectionRow {
  id: string;
  connectorId: string;
  name: string;
  status: string;
  baseUrl: string | null;
  operations: OperationRow[];
}

export default async function CustomApiIntegrationPage() {
  const { identity, context } = await createRepositoriesForCurrentTenant("/app/integrations/custom-api");
  const canAdmin = ["admin", "owner"].includes(identity.role);
  const canDevelop = ["developer", "security_admin", "admin", "owner"].includes(identity.role);

  const [{ data: connections }, { data: operations }] = await Promise.all([
    context.supabase
      .from("connector_connections")
      .select("id, connector_id, name, status, config")
      .like("connector_id", "custom\\_%")
      .order("created_at", { ascending: false }),
    context.supabase
      .from("custom_operation_definitions")
      .select(
        "id, connection_id, operation_slug, tool_name, name, method, path_template, effect, auth_type, status",
      )
      .order("created_at", { ascending: true }),
  ]);

  const rows: ConnectionRow[] = (connections ?? []).map((c) => ({
    id: c.id,
    connectorId: c.connector_id,
    name: c.name,
    status: c.status,
    baseUrl:
      typeof (c.config as Record<string, unknown> | null)?.baseUrl === "string"
        ? ((c.config as Record<string, unknown>).baseUrl as string)
        : null,
    operations: (operations ?? [])
      .filter((o) => o.connection_id === c.id)
      .map((o) => ({
        id: o.id,
        connectionId: o.connection_id,
        operationSlug: o.operation_slug,
        toolName: o.tool_name,
        name: o.name,
        method: o.method,
        pathTemplate: o.path_template,
        effect: o.effect,
        authType: o.auth_type,
        status: o.status,
      })),
  }));

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Custom API"
        description="Connect any HTTPS API your tenant controls, then define and publish named operations for it."
      />

      <details className="group rounded-[10px] border border-line bg-paper px-3.5 py-2.5">
        <summary className="cursor-pointer text-[13px] font-medium text-ink-soft marker:content-none">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block transition-transform group-open:rotate-90">›</span>
            Security details
          </span>
        </summary>
        <p className="mt-2 text-[13px] text-ink-soft">
          Every request is validated against a deterministic, non-executable schema, authenticated with a
          credential resolved server-side only, and sent only to the exact HTTPS destination you configured.
          Redirects are refused and private/internal network destinations are blocked outright — even if DNS
          later points your base URL there. Publishing an operation freezes its definition forever: every
          contract or capability that names it is pinned to exactly that definition.
        </p>
      </details>

      {canAdmin ? <ConnectConnectionForm /> : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="data_object"
          heading="No connections yet"
          description={
            canAdmin
              ? "Create a connection above, set its credential, then define and publish an operation."
              : "An admin has not connected a Custom API yet."
          }
        />
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
