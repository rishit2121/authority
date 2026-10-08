"use server";

import { revalidatePath } from "next/cache";

import { LINEAR_CONNECTOR_ID, linearConnector } from "@/lib/connectors/linear/connector";
import type { ConnectorHealthResult } from "@/lib/connectors/types";
import { setConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";
import {
  createConnectorConnection,
  disconnectConnectorConnection,
  updateConnectorConnectionHealth,
  type ConnectorConnectionStatus,
} from "@/lib/gateway/rpc-connectors";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export interface LinearActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const PAGE = "/app/integrations/linear";

const FRIENDLY: Record<string, string> = {
  forbidden: "Your role does not allow this. An admin is required.",
  already_connected: "A connection with that id already exists.",
  not_found: "That record was not found.",
  connection_not_found: "That connection was not found or is disconnected.",
};
const friendly = (code: string) => FRIENDLY[code] ?? "The request could not be completed.";

/** Maps the connector's own health vocabulary onto the smaller, persisted connection-status enum. */
function toConnectionStatus(status: ConnectorHealthResult["status"]): ConnectorConnectionStatus {
  switch (status) {
    case "active":
      return "active";
    case "suspended":
      return "suspended";
    case "disconnected":
      return "disconnected";
    case "permission_drift":
    case "not_configured":
    default:
      return "needs_attention";
  }
}

export interface LinearCredentialResult extends LinearActionResult {
  verified: boolean;
  healthStatus?: ConnectorConnectionStatus;
  reasons?: string[];
}

/**
 * Stores this connection's personal API key, then immediately calls the
 * connector's own `verifyInstallation()` (a real `{ viewer { id } }` query
 * against Linear) and persists the result — "saved" and "verified" are
 * always one action, mirroring the Stripe connector's own saveAndVerify.
 */
async function saveAndVerify(
  identity: { tenant: { tenantId: string }; userId: string },
  connectionId: string,
  plaintextSecret: string,
): Promise<LinearCredentialResult> {
  const secretResult = await setConnectorSecret({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId,
    secretType: "api_key",
    plaintextSecret,
  });
  if (secretResult !== "ok") {
    revalidatePath(PAGE);
    return { ok: false, verified: false, error: friendly(secretResult) };
  }

  const health = await linearConnector.verifyInstallation({ connectionId });
  const healthStatus = toConnectionStatus(health.status);
  await updateConnectorConnectionHealth({
    tenantId: identity.tenant.tenantId,
    connectionId,
    status: healthStatus,
    reasons: health.reasons,
  });
  revalidatePath(PAGE);

  if (healthStatus === "active") {
    return { ok: true, verified: true, healthStatus, message: "Connected and verified." };
  }
  return {
    ok: true,
    verified: false,
    healthStatus,
    reasons: health.reasons,
    message: "Saved, but Linear didn't accept this key — check it and try again.",
  };
}

export async function createLinearConnectionAction(
  name: string,
  plaintextSecret: string,
): Promise<LinearCredentialResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const created = await createConnectorConnection({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectorId: LINEAR_CONNECTOR_ID,
    name,
    environment: "development",
  });
  if (created.status !== "ok" || !created.connectionId) {
    return { ok: false, verified: false, error: friendly(created.status) };
  }
  return saveAndVerify(identity, created.connectionId, plaintextSecret);
}

/** Rotates an existing connection's key and re-verifies in the same step. */
export async function setLinearSecretAction(
  connectionId: string,
  plaintextSecret: string,
): Promise<LinearCredentialResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  return saveAndVerify(identity, connectionId, plaintextSecret);
}

/** Re-runs the health check against the already-saved key, without rotating it. */
export async function verifyLinearConnectionAction(connectionId: string): Promise<LinearCredentialResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const health = await linearConnector.verifyInstallation({ connectionId });
  const healthStatus = toConnectionStatus(health.status);
  const updated = await updateConnectorConnectionHealth({
    tenantId: identity.tenant.tenantId,
    connectionId,
    status: healthStatus,
    reasons: health.reasons,
  });
  revalidatePath(PAGE);
  if (updated !== "ok") return { ok: false, verified: false, error: friendly(updated) };
  return healthStatus === "active"
    ? { ok: true, verified: true, healthStatus, message: "Verified." }
    : {
        ok: true,
        verified: false,
        healthStatus,
        reasons: health.reasons,
        message: "Verification failed — check the key on Linear's side.",
      };
}

export async function disconnectLinearConnectionAction(connectionId: string): Promise<LinearActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await disconnectConnectorConnection({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId,
  });
  revalidatePath(PAGE);
  if (result.status !== "ok") return { ok: false, error: friendly(result.status) };
  return {
    ok: true,
    message: `Disconnected; ${result.revokedCapabilities ?? 0} live capabilit${result.revokedCapabilities === 1 ? "y" : "ies"} revoked.`,
  };
}
