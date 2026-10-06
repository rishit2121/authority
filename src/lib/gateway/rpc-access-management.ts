import "server-only";

import { gatewayQuery } from "./db";
import type { DeveloperApiStatus } from "./rpc-customers";

type Row = Record<string, unknown>;

/**
 * Backend self-service grant/revoke, scoped to whatever an admin has
 * explicitly allow-listed via `set_application_connection_access_policy`
 * (dashboard-only). A backend credential with no `can_manage_access` scope,
 * or a connection with no `backend_grantable` policy, is refused by the
 * underlying RPC itself -- this wrapper adds no authority of its own.
 */

/** Grants this customer use of a connection already marked `backend_grantable` for this application. Idempotent. */
export async function grantConnectionAccessForBackend(input: {
  credentialSecret: string;
  connectionId: string;
  customerId: string;
}): Promise<DeveloperApiStatus> {
  const rows = await gatewayQuery<{ grant_connection_access_for_backend: string }>(
    `select gateway.grant_connection_access_for_backend($1, $2::uuid, $3::uuid) as grant_connection_access_for_backend`,
    [input.credentialSecret, input.connectionId, input.customerId],
  );
  return rows[0].grant_connection_access_for_backend;
}

/** Revokes a previously backend-granted (or admin-granted) delegation. Idempotent -- revoking an already-revoked or never-granted pair is `ok`, not an error. */
export async function revokeConnectionAccessForBackend(input: {
  credentialSecret: string;
  connectionId: string;
  customerId: string;
}): Promise<DeveloperApiStatus> {
  const rows = await gatewayQuery<{ revoke_connection_access_for_backend: string }>(
    `select gateway.revoke_connection_access_for_backend($1, $2::uuid, $3::uuid) as revoke_connection_access_for_backend`,
    [input.credentialSecret, input.connectionId, input.customerId],
  );
  return rows[0].revoke_connection_access_for_backend;
}

export interface CustomerConnectionAccessRow {
  connectionId: string;
  connectorId: string;
  grantedAt: string;
}

export interface ListConnectionAccessResult {
  status: DeveloperApiStatus;
  connections: CustomerConnectionAccessRow[];
}

/** Every connection this customer currently has access to (however it was granted -- admin dashboard click or backend self-service). */
export async function listConnectionAccessForBackend(
  secret: string,
  customerId: string,
): Promise<ListConnectionAccessResult> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.list_connection_access_for_backend($1, $2::uuid)`,
    [secret, customerId],
  );
  const status = (rows[0]?.lca_status as string) ?? "unknown";
  if (status !== "ok") return { status, connections: [] };
  return {
    status,
    connections: rows
      .filter((r) => r.lca_connection_id != null)
      .map((r) => ({
        connectionId: r.lca_connection_id as string,
        connectorId: r.lca_connector_id as string,
        grantedAt: r.lca_granted_at as string,
      })),
  };
}
