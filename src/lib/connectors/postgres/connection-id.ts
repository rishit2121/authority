import "server-only";

/**
 * Postgres's provider id is per-tenant-connection, not a fixed deployment
 * constant -- same reasoning and shape as Custom API's own
 * ../custom-api/connection-id.ts, copied rather than shared so the two
 * connectors stay independent. A tenant may reasonably run more than one
 * simultaneously active Postgres connection (e.g. a primary and a read
 * replica), unlike Stripe/Slack/Gmail's one-account-at-a-time model, which
 * is exactly why a fixed "postgres" id would not work here.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32_RE = /^[0-9a-f]{32}$/;

export const POSTGRES_CONNECTOR_PREFIX = "postgres_";

export function toPostgresConnectorId(connectionId: string): string {
  if (!UUID_RE.test(connectionId)) {
    throw new Error("connectionId must be a UUID");
  }
  return `${POSTGRES_CONNECTOR_PREFIX}${connectionId.replace(/-/g, "").toLowerCase()}`;
}

/** Returns null for anything that isn't a well-formed Postgres connector id -- callers must treat that as "not found," never fall back to a guess. */
export function connectionIdFromPostgresConnectorId(connectorId: string): string | null {
  if (!connectorId.startsWith(POSTGRES_CONNECTOR_PREFIX)) return null;
  const hex = connectorId.slice(POSTGRES_CONNECTOR_PREFIX.length);
  if (!HEX32_RE.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
