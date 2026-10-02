import "server-only";

import type { AuthorityConnector } from "./types";

/**
 * Maps a tool's provider prefix to the `AuthorityConnector` instance that
 * owns it. Populated once per process by each connector module calling
 * `registerConnector()` at import time (see `src/lib/connectors/index.ts`).
 *
 * This is process memory, not a database table: which connector *code*
 * handles `stripe.*` is a deployment fact, not tenant-configurable data.
 * What IS tenant-configurable (whether a given tenant has actually connected
 * Stripe, which connection to use, credentials) lives behind
 * `AuthorityConnector.verifyInstallation()`/`execute()`'s own `ConnectorContext`.
 */
const connectors = new Map<string, AuthorityConnector>();

export function registerConnector(connector: AuthorityConnector): void {
  if (connectors.has(connector.id)) {
    throw new Error(`Connector "${connector.id}" is already registered.`);
  }
  connectors.set(connector.id, connector);
}

/** For tests only — production code never needs to unregister a connector mid-process. */
export function resetConnectorRegistryForTests(): void {
  connectors.clear();
}

function providerOf(tool: string): string | null {
  const dot = tool.indexOf(".");
  if (dot <= 0 || dot === tool.length - 1) return null;
  return tool.slice(0, dot);
}

export function resolveConnectorForTool(tool: string): AuthorityConnector | null {
  const provider = providerOf(tool);
  if (!provider) return null;
  const exact = connectors.get(provider);
  if (exact) return exact;
  // Connectors whose provider id is dynamic per tenant connection (Custom
  // API's "custom_<connectionId>") register once under a fixed, trailing-
  // underscore prefix (e.g. "custom_"). Every tool whose provider starts
  // with that prefix resolves to the same connector instance, which derives
  // the specific connection id from the tool name itself -- no per-
  // connection, per-process registration is needed (and none would survive
  // a serverless restart or be visible to another instance anyway).
  for (const [registeredId, connector] of connectors) {
    if (registeredId.endsWith("_") && provider.startsWith(registeredId)) return connector;
  }
  return null;
}

export function listRegisteredConnectors(): readonly AuthorityConnector[] {
  return Array.from(connectors.values());
}
