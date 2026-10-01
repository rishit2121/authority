import type { Metadata } from "next";

import { Icon } from "@/components/ui/Icon";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

import {
  ConnectConnectionForm,
  ConnectionCard,
} from "./CustomApiControls";

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
      .select("id, connection_id, operation_slug, tool_name, name, method, path_template, effect, auth_type, status")
      .order("created_at", { ascending: true }),
  ]);

  const rows: ConnectionRow[] = (connections ?? []).map((c) => ({
    id: c.id,
    connectorId: c.connector_id,
    name: c.name,
    status: c.status,
    baseUrl: typeof (c.config as Record<string, unknown> | null)?.baseUrl === "string" ? ((c.config as Record<string, unknown>).baseUrl as string) : null,
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
      <header>
        <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          Custom API
        </h1>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          Connect any HTTPS API your tenant controls. Operations are named, schema-constrained, and start as
          drafts: a developer defines and validates one, but only an administrator can publish it. Publishing is
          the trust boundary — a published operation&apos;s definition is then frozen forever, and every
          contract or capability that names it is pinned to exactly that definition.
        </p>
      </header>

      <div
        role="note"
        className="flex items-start gap-space-sm rounded-lg border border-outline-variant/30 bg-surface-container px-space-md py-2.5"
      >
        <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-outline" />
        <p className="font-body-md text-body-sm text-on-surface-variant">
          Every request is validated against a deterministic, non-executable schema, authenticated with a
          credential resolved server-side only, and sent only to the exact HTTPS destination you configured —
          redirects are refused and private/internal network destinations are blocked outright.
        </p>
      </div>

      {canAdmin ? <ConnectConnectionForm /> : null}

      {rows.length === 0 ? (
        <section
          className="rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-low p-space-lg"
          data-testid="custom-api-not-connected"
        >
          <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">No connections yet</h2>
          <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
            {canAdmin
              ? "Create a connection above, set its credential, then define and publish an operation."
              : "An admin has not connected a Custom API yet."}
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
