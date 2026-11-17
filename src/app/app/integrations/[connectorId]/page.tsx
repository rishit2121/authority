import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { REST_CONNECTOR_SPECS } from "@/lib/connectors/rest/providers";
import { parseSpec } from "@/lib/connectors/rest/request";
import { hasConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

import { ConnectForm, ConnectionCard, type RestConnectionView, type RestConnectorView } from "./RestControls";

/**
 * The dashboard page for every declarative REST connector (Sentry, Asana, HubSpot, ...). The hand-written
 * connectors (slack, gmail, github, notion, linear, stripe, postgres, custom-api) have their own static folders,
 * which Next.js matches before this dynamic segment.
 */

function specFor(connectorId: string) {
  const spec = REST_CONNECTOR_SPECS.find((s) => s.id === connectorId);
  return spec ? parseSpec(spec) : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ connectorId: string }>;
}): Promise<Metadata> {
  const spec = specFor((await params).connectorId);
  return { title: spec ? `${spec.name} connector` : "Connector" };
}

function displayStatus(
  dbStatus: string,
  hasSecret: boolean,
  lastVerifiedAt: string | null,
): RestConnectionView["status"] {
  if (dbStatus === "disconnected") return "disconnected";
  if (!hasSecret) return "setup_incomplete";
  if (!lastVerifiedAt) return "unverified";
  if (dbStatus === "active") return "verified";
  if (dbStatus === "suspended") return "suspended";
  return "needs_attention";
}

const SIDE_EFFECT_LABEL = {
  read: "read",
  write_create: "create",
  write_update: "update",
  write_delete: "delete",
} as const;

export default async function RestConnectorPage({ params }: { params: Promise<{ connectorId: string }> }) {
  const { connectorId } = await params;
  const spec = specFor(connectorId);
  if (!spec) notFound();

  const page = `/app/integrations/${spec.id}`;
  const { identity, context } = await createRepositoriesForCurrentTenant(page);
  const canAdmin = ["admin", "owner"].includes(identity.role);

  const { data: connections } = await context.supabase
    .from("connector_connections")
    .select("id, name, status, last_verified_at, config")
    .eq("tenant_id", identity.tenant.tenantId)
    .eq("connector_id", spec.id)
    .neq("status", "disconnected")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  const rows: RestConnectionView[] = await Promise.all(
    (connections ?? []).map(async (c) => {
      const hasSecret = await hasConnectorSecret(c.id, "api_key");
      const config = (c.config ?? {}) as Record<string, unknown>;
      return {
        id: c.id,
        name: c.name,
        status: displayStatus(c.status, hasSecret, c.last_verified_at),
        config: Object.fromEntries(
          spec.configFields
            .filter((f) => typeof config[f.key] === "string")
            .map((f) => [f.key, config[f.key] as string]),
        ),
      };
    }),
  );

  const view: RestConnectorView = {
    id: spec.id,
    name: spec.name,
    credential: spec.credential,
    configFields: spec.configFields.map(({ key, label, placeholder, help }) => ({
      key,
      label,
      placeholder,
      help,
    })),
  };
  const host = spec.host.replace(/^\{config\.[a-z0-9_]+\}\./, "<your account>.");

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title={spec.name}
        description={`${spec.description} A fixed, audited set of operations against ${spec.name}'s own API.`}
        secondaryAction={{ label: `${spec.name} API reference`, href: spec.docsUrl }}
      />

      <section className="flex flex-col gap-2" aria-labelledby="rest-operations-heading">
        <h2 id="rest-operations-heading" className="text-[13px] font-semibold text-ink">
          What an agent can ask for
        </h2>
        <ul className="flex flex-col gap-1.5" data-testid="rest-operations">
          {spec.operations.map((op) => (
            <li
              key={op.slug}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-paper-raised px-3 py-2"
            >
              <code className="text-[12px] text-ink">
                {spec.id}.{op.slug}
              </code>
              <span className="text-[12px] text-ink-soft">{op.summary}</span>
              <span className="ml-auto flex gap-1.5">
                {op.externalCommunication ? (
                  <span className="rounded bg-deny/10 px-1.5 py-0.5 text-[10px] uppercase text-deny">
                    external
                  </span>
                ) : null}
                {op.financialImpact ? (
                  <span className="rounded bg-deny/10 px-1.5 py-0.5 text-[10px] uppercase text-deny">
                    money
                  </span>
                ) : null}
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                    op.sideEffect === "read" ? "bg-allow/10 text-allow" : "bg-black/[0.05] text-ink"
                  }`}
                >
                  {SIDE_EFFECT_LABEL[op.sideEffect]}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-ink-soft">
          Calls go only to <code>https://{host}</code>. Each task still gets only the operations, and the
          exact ids, it needs; anything else is refused before it reaches {spec.name}.
        </p>
      </section>

      <details className="group rounded-[10px] border border-line bg-paper px-3.5 py-2.5">
        <summary className="cursor-pointer text-[13px] font-medium text-ink-soft marker:content-none">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block transition-transform group-open:rotate-90">›</span>
            Security details
          </span>
        </summary>
        <p className="mt-2 text-[13px] text-ink-soft">
          The {spec.credential.label.toLowerCase()} is stored in Supabase Vault and resolved only when an
          authorized call is sent. It is never returned to this browser, put in a URL or logged. It acts as
          whoever created it in {spec.name}, so give it only the access agents should have. This connector is
          checked against
          {` ${spec.name}`}&apos;s published API reference and a mock of it; it has not yet been run against a
          live {spec.name} account by the Authority team.
        </p>
      </details>

      {canAdmin ? <ConnectForm connector={view} /> : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="token"
          heading="No connections yet"
          description={
            canAdmin
              ? `Connect ${spec.name} above to get started.`
              : `An admin has not connected ${spec.name} yet.`
          }
        />
      ) : (
        <div className="flex flex-col gap-space-md">
          {rows.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connector={view}
              connection={connection}
              canAdmin={canAdmin}
            />
          ))}
        </div>
      )}
    </div>
  );
}
