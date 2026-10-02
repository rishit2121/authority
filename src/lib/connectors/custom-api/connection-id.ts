import "server-only";

/**
 * Custom API is the one connector whose provider id is per-tenant-connection
 * rather than a fixed deployment constant ("stripe", "slack"). Encoding the
 * connection's own UUID into the provider id lets `normalizeRequest()` --
 * which receives only a tool string, no `ConnectorContext` -- recover the
 * exact connection to query without a prior database round trip. See
 * 20261001000008_connector_connection_explicit_id.sql for the matching
 * create-with-explicit-id RPC parameter.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32_RE = /^[0-9a-f]{32}$/;

export const CUSTOM_API_CONNECTOR_PREFIX = "custom_";

export function toCustomApiConnectorId(connectionId: string): string {
  if (!UUID_RE.test(connectionId)) {
    throw new Error("connectionId must be a UUID");
  }
  return `${CUSTOM_API_CONNECTOR_PREFIX}${connectionId.replace(/-/g, "").toLowerCase()}`;
}

/** Returns null for anything that isn't a well-formed Custom API connector id -- callers must treat that as "not found," never fall back to a guess. */
export function connectionIdFromCustomApiConnectorId(connectorId: string): string | null {
  if (!connectorId.startsWith(CUSTOM_API_CONNECTOR_PREFIX)) return null;
  const hex = connectorId.slice(CUSTOM_API_CONNECTOR_PREFIX.length);
  if (!HEX32_RE.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
