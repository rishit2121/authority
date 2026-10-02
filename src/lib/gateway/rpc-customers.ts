import "server-only";

import { gatewayQuery } from "./db";

type Row = Record<string, unknown>;

/**
 * Every developer-API RPC's own status vocabulary, returned by
 * gateway.resolve_backend_credential plus whatever that specific call adds
 * (customer_not_found, invalid_intent, ...). Deliberately a plain string,
 * not a closed union: new RPCs add new codes without a central type to keep
 * in sync, the same choice already made for reserve_connector_execution's
 * reasonCode (see rpc-connectors.ts).
 */
export type DeveloperApiStatus = string;

export interface ResolvedBackendCredential {
  status: DeveloperApiStatus;
  tenantId: string | null;
  applicationId: string | null;
  credentialId: string | null;
}

export async function resolveBackendCredential(secret: string): Promise<ResolvedBackendCredential> {
  const rows = await gatewayQuery<Row>(`select * from gateway.resolve_backend_credential($1)`, [secret]);
  const r = rows[0];
  return {
    status: r.rbc_status as string,
    tenantId: (r.rbc_tenant_id as string) ?? null,
    applicationId: (r.rbc_application_id as string) ?? null,
    credentialId: (r.rbc_credential_id as string) ?? null,
  };
}

export interface CreateOrResolveCustomerResult {
  status: DeveloperApiStatus;
  customerId: string | null;
  wasCreated: boolean;
}

/** Idempotent by the application's own external id -- see the migration's own comment. */
export async function createOrResolveCustomer(input: {
  credentialSecret: string;
  externalId: string;
  displayLabel?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<CreateOrResolveCustomerResult> {
  const metadata = { schemaVersion: 1, ...(input.metadata ?? {}) };
  const rows = await gatewayQuery<Row>(
    `select * from gateway.create_or_resolve_customer($1, $2, $3, $4::jsonb)`,
    [input.credentialSecret, input.externalId, input.displayLabel ?? null, JSON.stringify(metadata)],
  );
  const r = rows[0];
  return {
    status: r.coc_status as string,
    customerId: (r.coc_customer_id as string) ?? null,
    wasCreated: Boolean(r.coc_was_created),
  };
}

export interface CustomerConnection {
  connectionId: string;
  connectorId: string;
  status: string;
  ownerKind: "organization" | "customer";
  verifiedAccountRef: string | null;
  createdAt: string;
}

export interface ListCustomerConnectionsResult {
  status: DeveloperApiStatus;
  connections: CustomerConnection[];
}

export async function listCustomerConnections(input: {
  credentialSecret: string;
  customerId: string;
}): Promise<ListCustomerConnectionsResult> {
  const rows = await gatewayQuery<Row>(`select * from gateway.list_customer_connections($1, $2::uuid)`, [
    input.credentialSecret,
    input.customerId,
  ]);
  const status = (rows[0]?.lcc_status as string) ?? "unknown";
  if (status !== "ok") {
    return { status, connections: [] };
  }
  return {
    status,
    connections: rows
      .filter((r) => r.lcc_connection_id != null)
      .map((r) => ({
        connectionId: r.lcc_connection_id as string,
        connectorId: r.lcc_connector_id as string,
        status: r.lcc_status_value as string,
        ownerKind: r.lcc_owner_kind as "organization" | "customer",
        verifiedAccountRef: (r.lcc_verified_account_ref as string) ?? null,
        createdAt: r.lcc_created_at as string,
      })),
  };
}

export interface ConnectorBindingInput {
  connectorId: string;
  connectionId: string;
}

export interface CreateCustomerTaskResult {
  status: DeveloperApiStatus;
  taskId: string | null;
  wasCreated: boolean;
}

/** Creates a customer-scoped task with every requested connector binding set atomically before contract compilation can see it. */
export async function createCustomerTask(input: {
  credentialSecret: string;
  customerId: string;
  agentId: string;
  intent: string;
  connectorBindings: ConnectorBindingInput[];
  idempotencyKey?: string | null;
}): Promise<CreateCustomerTaskResult> {
  const bindings = input.connectorBindings.map((b) => ({
    connectorId: b.connectorId,
    connectionId: b.connectionId,
  }));
  const rows = await gatewayQuery<Row>(
    `select * from gateway.create_customer_task($1, $2::uuid, $3::uuid, $4, $5::jsonb, $6)`,
    [
      input.credentialSecret,
      input.customerId,
      input.agentId,
      input.intent,
      JSON.stringify(bindings),
      input.idempotencyKey ?? null,
    ],
  );
  const r = rows[0];
  return {
    status: r.cct_status as string,
    taskId: (r.cct_task_id as string) ?? null,
    wasCreated: Boolean(r.cct_was_created),
  };
}
