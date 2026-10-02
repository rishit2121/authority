import "server-only";

import { gatewayQuery } from "./db";

/**
 * Typed wrappers over connector credential storage (Supabase Vault-backed,
 * 20261001000006_connector_secrets.sql). `resolveConnectorSecret` takes no
 * human actor by design -- it is called only from server-side connector
 * execution code, after reserve_connector_execution has already verified
 * capability/task/tenant/operation match. Never call it from a client-facing
 * route or return its result to a browser or agent.
 */

export type ConnectorSecretType = "bearer_token" | "api_key" | "basic_username" | "basic_password";

export async function setConnectorSecret(input: {
  tenantId: string;
  userId: string;
  connectionId: string;
  secretType: ConnectorSecretType;
  plaintextSecret: string;
}): Promise<"ok" | "forbidden" | "connection_not_found"> {
  const rows = await gatewayQuery<{ set_connector_secret: string }>(
    `select gateway.set_connector_secret($1::uuid, $2::uuid, $3::uuid, $4, $5) as set_connector_secret`,
    [input.tenantId, input.userId, input.connectionId, input.secretType, input.plaintextSecret],
  );
  return rows[0].set_connector_secret as "ok" | "forbidden" | "connection_not_found";
}

/** Server-only. Never expose this value to a client response, log line, or error message. */
export async function resolveConnectorSecret(
  connectionId: string,
  secretType: ConnectorSecretType,
): Promise<string | null> {
  const rows = await gatewayQuery<{ resolve_connector_secret: string | null }>(
    `select gateway.resolve_connector_secret($1::uuid, $2) as resolve_connector_secret`,
    [connectionId, secretType],
  );
  return rows[0]?.resolve_connector_secret ?? null;
}

export async function hasConnectorSecret(
  connectionId: string,
  secretType: ConnectorSecretType,
): Promise<boolean> {
  const rows = await gatewayQuery<{ has_connector_secret: boolean }>(
    `select gateway.has_connector_secret($1::uuid, $2) as has_connector_secret`,
    [connectionId, secretType],
  );
  return rows[0]?.has_connector_secret ?? false;
}

export interface ConnectorConnectionConfig {
  status: string;
  config: Record<string, unknown>;
  lastVerifiedAt: string | null;
}

/** Generic connection read usable by any connector's verifyInstallation(). Returns null for a disconnected or nonexistent connection. */
export async function getConnectorConnectionConfig(
  connectionId: string,
): Promise<ConnectorConnectionConfig | null> {
  const rows = await gatewayQuery<{
    gccc_status: string;
    gccc_config: Record<string, unknown>;
    gccc_last_verified_at: string | null;
  }>(`select * from gateway.get_connector_connection_config($1::uuid)`, [connectionId]);
  const r = rows[0];
  if (!r) return null;
  return { status: r.gccc_status, config: r.gccc_config ?? {}, lastVerifiedAt: r.gccc_last_verified_at };
}

export async function updateConnectorConnectionConfig(input: {
  tenantId: string;
  userId: string;
  connectionId: string;
  config: Record<string, unknown>;
}): Promise<"ok" | "forbidden" | "not_found"> {
  const rows = await gatewayQuery<{ update_connector_connection_config: string }>(
    `select gateway.update_connector_connection_config($1::uuid, $2::uuid, $3::uuid, $4::jsonb) as update_connector_connection_config`,
    [input.tenantId, input.userId, input.connectionId, JSON.stringify(input.config)],
  );
  return rows[0].update_connector_connection_config as "ok" | "forbidden" | "not_found";
}
