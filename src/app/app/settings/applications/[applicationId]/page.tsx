import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  AutomationPoliciesPanel,
  type AutomationPolicyRow,
} from "@/components/application/AutomationPoliciesPanel";
import {
  BackendCredentialsPanel,
  type BackendCredentialRow,
} from "@/components/application/BackendCredentialsPanel";
import {
  ConnectionBrokersPanel,
  type ConnectionBrokerRow,
} from "@/components/application/ConnectionBrokersPanel";
import {
  ConnectionDelegationPanel,
  type CustomerOption,
  type OrganizationConnectionRow,
} from "@/components/application/ConnectionDelegationPanel";
import { CustomersPanel, type CustomerRow } from "@/components/application/CustomersPanel";
import { ReturnUrlsForm } from "@/components/application/ReturnUrlsForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export const metadata: Metadata = { title: "Application" };

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  const { identity, context } = await createRepositoriesForCurrentTenant(
    `/app/settings/applications/${applicationId}`,
  );

  const { data: application } = await context.supabase
    .from("applications")
    .select("id, name, slug, environment, status, allowed_return_urls")
    .eq("id", applicationId)
    .maybeSingle();
  if (!application || !identity.tenant.tenantId) notFound();

  const [
    credentialsResult,
    customersResult,
    orgConnectionsResult,
    delegationsResult,
    brokersResult,
    automationPoliciesResult,
  ] = await Promise.all([
    context.supabase
      .from("developer_backend_credentials")
      .select("id, key_prefix, status, created_at, last_used_at, revoked_at, revocation_reason")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false }),
    context.supabase
      .from("customers")
      .select("id, external_id, display_label, status, created_at")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false }),
    context.supabase
      .from("connector_connections")
      .select("id, connector_id, status, verified_account_ref")
      .eq("owner_kind", "organization")
      .neq("status", "disconnected")
      .order("created_at", { ascending: false }),
    context.supabase
      .from("connection_delegations")
      .select("connection_id, customer_id")
      .is("revoked_at", null),
    context.supabase
      .from("connection_brokers")
      .select("id, url, status, created_at")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false }),
    context.supabase
      .from("automation_policies")
      .select("id, tool, created_at")
      .eq("application_id", applicationId)
      .is("revoked_at", null)
      .order("tool", { ascending: true }),
  ]);

  const customersById = new Map((customersResult.data ?? []).map((c) => [c.id, c]));

  const { data: customerConnections } = await context.supabase
    .from("connector_connections")
    .select("id, connector_id, status, verified_account_ref, owner_customer_id")
    .eq("owner_kind", "customer")
    .in(
      "owner_customer_id",
      [...customersById.keys()].length > 0
        ? [...customersById.keys()]
        : ["00000000-0000-0000-0000-000000000000"],
    );

  const customers: CustomerRow[] = (customersResult.data ?? []).map((c) => ({
    id: c.id,
    externalId: c.external_id,
    displayLabel: c.display_label,
    status: c.status,
    createdAt: c.created_at,
    connections: (customerConnections ?? [])
      .filter((conn) => conn.owner_customer_id === c.id)
      .map((conn) => ({
        connectorId: conn.connector_id,
        status: conn.status,
        verifiedAccountRef: conn.verified_account_ref,
      })),
  }));

  const credentials: BackendCredentialRow[] = (credentialsResult.data ?? []).map((row) => ({
    id: row.id,
    keyPrefix: row.key_prefix,
    status: row.status as "active" | "revoked",
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    revocationReason: row.revocation_reason,
  }));

  const delegationsByConnection = new Map<string, string[]>();
  for (const d of delegationsResult.data ?? []) {
    const list = delegationsByConnection.get(d.connection_id) ?? [];
    list.push(d.customer_id);
    delegationsByConnection.set(d.connection_id, list);
  }

  const customerLabel = (id: string) => {
    const c = customersById.get(id);
    return c?.display_label ?? c?.external_id ?? id;
  };

  const orgConnections: OrganizationConnectionRow[] = (orgConnectionsResult.data ?? []).map((conn) => ({
    connectionId: conn.id,
    connectorId: conn.connector_id,
    status: conn.status,
    verifiedAccountRef: conn.verified_account_ref,
    delegations: (delegationsByConnection.get(conn.id) ?? []).map((customerId) => ({
      customerId,
      customerLabel: customerLabel(customerId),
    })),
  }));

  const customerOptions: CustomerOption[] = (customersResult.data ?? []).map((c) => ({
    id: c.id,
    label: c.display_label ?? c.external_id,
  }));

  const brokers: ConnectionBrokerRow[] = (brokersResult.data ?? []).map((b) => ({
    id: b.id,
    url: b.url,
    status: b.status as "active" | "revoked",
    createdAt: b.created_at,
  }));

  const automationPolicies: AutomationPolicyRow[] = (automationPoliciesResult.data ?? []).map((p) => ({
    id: p.id,
    tool: p.tool,
    createdAt: p.created_at,
  }));

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        eyebrow={application.environment}
        title={application.name}
        description={`Slug: ${application.slug}`}
      />

      <BackendCredentialsPanel applicationId={applicationId} credentials={credentials} />
      <ReturnUrlsForm applicationId={applicationId} initialUrls={application.allowed_return_urls ?? []} />
      <CustomersPanel customers={customers} />
      <ConnectionBrokersPanel applicationId={applicationId} brokers={brokers} />
      <ConnectionDelegationPanel
        applicationId={applicationId}
        connections={orgConnections}
        customerOptions={customerOptions}
      />
      <AutomationPoliciesPanel applicationId={applicationId} policies={automationPolicies} />
    </div>
  );
}
