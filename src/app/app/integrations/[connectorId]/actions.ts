"use server";

import { revalidatePath } from "next/cache";

import { restConnectors } from "@/lib/connectors/rest";
import { REST_CONNECTOR_SPECS } from "@/lib/connectors/rest/providers";
import { configValues, parseSpec, RestRequestError } from "@/lib/connectors/rest/request";
import type { ConnectorHealthResult } from "@/lib/connectors/types";
import { setConnectorSecret, updateConnectorConnectionConfig } from "@/lib/gateway/rpc-connector-secrets";
import {
  createConnectorConnection,
  disconnectConnectorConnection,
  updateConnectorConnectionHealth,
  type ConnectorConnectionStatus,
} from "@/lib/gateway/rpc-connectors";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

/**
 * Dashboard actions shared by every declarative REST connector (src/lib/connectors/rest). Same shape as the
 * hand-written Linear/Notion pages: create a connection, store its secret in Vault, verify it against the provider,
 * rotate, re-verify, disconnect. Every action re-checks that the connection belongs to the named connector, so a
 * secret saved for one service can never be sent to another service's host.
 */

export interface RestActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  verified?: boolean;
}

const FRIENDLY: Record<string, string> = {
  forbidden: "Your role does not allow this. An admin is required.",
  already_connected: "A connection with that name already exists.",
  not_found: "That record was not found.",
  connection_not_found: "That connection was not found or is disconnected.",
};
const friendly = (code: string) => FRIENDLY[code] ?? "The request could not be completed.";

function specFor(connectorId: string) {
  const spec = REST_CONNECTOR_SPECS.find((s) => s.id === connectorId);
  return spec ? parseSpec(spec) : null;
}

function connectorFor(connectorId: string) {
  return restConnectors().find((c) => c.id === connectorId) ?? null;
}

function toConnectionStatus(status: ConnectorHealthResult["status"]): ConnectorConnectionStatus {
  switch (status) {
    case "active":
      return "active";
    case "suspended":
      return "suspended";
    case "disconnected":
      return "disconnected";
    default:
      return "needs_attention";
  }
}

const REASON_TEXT: Record<string, string> = {
  "PERMISSION_MISSING:api_key": "the provider rejected the credential (401/403)",
  VERIFY_CALL_FAILED: "the provider could not be reached",
  API_KEY_NOT_CONFIGURED: "no credential is saved",
};

function reasonText(reasons: string[]): string {
  const first = reasons[0] ?? "";
  if (REASON_TEXT[first]) return REASON_TEXT[first]!;
  if (first.startsWith("UPSTREAM_STATUS_")) return `the provider answered HTTP ${first.slice(16)}`;
  if (first.startsWith("CONFIG_INVALID:")) return `the setting "${first.slice(15)}" is missing or invalid`;
  return "verification failed";
}

/**
 * The connection, only if the caller is an admin of the current workspace, the connection is in that workspace, and
 * it belongs to this connector.
 */
async function ownedConnection(connectorId: string, connectionId: string, page: string) {
  const { identity, context } = await createRepositoriesForCurrentTenant(page);
  if (!["admin", "owner"].includes(identity.role)) return { identity, connection: null };
  const { data } = await context.supabase
    .from("connector_connections")
    .select("id, connector_id, config")
    .eq("id", connectionId)
    .eq("tenant_id", identity.tenant.tenantId)
    .maybeSingle();
  if (!data || data.connector_id !== connectorId) return { identity, connection: null };
  return { identity, connection: data };
}

async function verifyAndRecord(
  identity: { tenant: { tenantId: string } },
  connectorId: string,
  connectionId: string,
  page: string,
): Promise<RestActionResult> {
  const connector = connectorFor(connectorId);
  if (!connector) return { ok: false, error: "Unknown connector." };
  const health = await connector.verifyInstallation({ connectionId });
  const status = toConnectionStatus(health.status);
  await updateConnectorConnectionHealth({
    tenantId: identity.tenant.tenantId,
    connectionId,
    status,
    reasons: health.reasons,
  });
  revalidatePath(page);
  return status === "active"
    ? { ok: true, verified: true, message: "Connected and verified." }
    : { ok: true, verified: false, message: `Saved, but not verified: ${reasonText(health.reasons)}.` };
}

function checkedConfig(connectorId: string, raw: Record<string, string>): Record<string, string> | string {
  const spec = specFor(connectorId);
  if (!spec) return "Unknown connector.";
  const trimmed = Object.fromEntries(spec.configFields.map((f) => [f.key, (raw[f.key] ?? "").trim()]));
  try {
    return configValues(spec, trimmed);
  } catch (error) {
    const field = error instanceof RestRequestError ? error.message.replace("CONFIG_INVALID:", "") : "";
    const label = spec.configFields.find((f) => f.key === field)?.label ?? field;
    return `"${label}" doesn't look right.`;
  }
}

export async function createRestConnectionAction(
  connectorId: string,
  name: string,
  secret: string,
  config: Record<string, string>,
): Promise<RestActionResult> {
  const page = `/app/integrations/${connectorId}`;
  const spec = specFor(connectorId);
  if (!spec) return { ok: false, error: "Unknown connector." };
  const settings = checkedConfig(connectorId, config);
  if (typeof settings === "string") return { ok: false, error: settings };
  if (!secret.trim()) return { ok: false, error: `Enter the ${spec.credential.label}.` };

  const { identity } = await createRepositoriesForCurrentTenant(page);
  if (!["admin", "owner"].includes(identity.role)) return { ok: false, error: friendly("forbidden") };
  const created = await createConnectorConnection({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectorId,
    name: name.trim() || spec.name,
    environment: "development",
  });
  if (created.status !== "ok" || !created.connectionId) return { ok: false, error: friendly(created.status) };
  const connectionId = created.connectionId;

  if (spec.configFields.length > 0) {
    const saved = await updateConnectorConnectionConfig({
      tenantId: identity.tenant.tenantId,
      userId: identity.userId,
      connectionId,
      config: settings,
    });
    if (saved !== "ok") return { ok: false, error: friendly(saved) };
  }
  const stored = await setConnectorSecret({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId,
    secretType: "api_key",
    plaintextSecret: secret.trim(),
  });
  if (stored !== "ok") {
    revalidatePath(page);
    return { ok: false, error: friendly(stored) };
  }
  return verifyAndRecord(identity, connectorId, connectionId, page);
}

/** Replaces the stored secret (and, when given, the settings), then re-verifies. */
export async function updateRestConnectionAction(
  connectorId: string,
  connectionId: string,
  secret: string,
  config: Record<string, string> | null,
): Promise<RestActionResult> {
  const page = `/app/integrations/${connectorId}`;
  const { identity, connection } = await ownedConnection(connectorId, connectionId, page);
  if (!connection) return { ok: false, error: friendly("connection_not_found") };
  if (config) {
    const settings = checkedConfig(connectorId, config);
    if (typeof settings === "string") return { ok: false, error: settings };
    const saved = await updateConnectorConnectionConfig({
      tenantId: identity.tenant.tenantId,
      userId: identity.userId,
      connectionId,
      config: { ...(connection.config as Record<string, unknown>), ...settings },
    });
    if (saved !== "ok") return { ok: false, error: friendly(saved) };
  }
  if (secret.trim()) {
    const stored = await setConnectorSecret({
      tenantId: identity.tenant.tenantId,
      userId: identity.userId,
      connectionId,
      secretType: "api_key",
      plaintextSecret: secret.trim(),
    });
    if (stored !== "ok") return { ok: false, error: friendly(stored) };
  }
  return verifyAndRecord(identity, connectorId, connectionId, page);
}

export async function verifyRestConnectionAction(
  connectorId: string,
  connectionId: string,
): Promise<RestActionResult> {
  const page = `/app/integrations/${connectorId}`;
  const { identity, connection } = await ownedConnection(connectorId, connectionId, page);
  if (!connection) return { ok: false, error: friendly("connection_not_found") };
  const result = await verifyAndRecord(identity, connectorId, connectionId, page);
  return result.verified ? { ...result, message: "Verified." } : result;
}

export async function disconnectRestConnectionAction(
  connectorId: string,
  connectionId: string,
): Promise<RestActionResult> {
  const page = `/app/integrations/${connectorId}`;
  const { identity, connection } = await ownedConnection(connectorId, connectionId, page);
  if (!connection) return { ok: false, error: friendly("connection_not_found") };
  const result = await disconnectConnectorConnection({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId,
  });
  revalidatePath(page);
  if (result.status !== "ok") return { ok: false, error: friendly(result.status) };
  const n = result.revokedCapabilities ?? 0;
  return { ok: true, message: `Disconnected; ${n} live capabilit${n === 1 ? "y" : "ies"} revoked.` };
}
