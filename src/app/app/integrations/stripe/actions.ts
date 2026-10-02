"use server";

import { revalidatePath } from "next/cache";

import { STRIPE_CONNECTOR_ID, stripeConnector } from "@/lib/connectors/stripe/connector";
import type { ConnectorHealthResult } from "@/lib/connectors/types";
import { setConnectorSecret, updateConnectorConnectionConfig } from "@/lib/gateway/rpc-connector-secrets";
import {
  createConnectorConnection,
  disconnectConnectorConnection,
  updateConnectorConnectionHealth,
  type ConnectorConnectionStatus,
} from "@/lib/gateway/rpc-connectors";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export interface StripeActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const PAGE = "/app/integrations/stripe";

const FRIENDLY: Record<string, string> = {
  forbidden: "Your role does not allow this. An admin is required.",
  already_connected: "A connection with that id already exists.",
  not_found: "That record was not found.",
  connection_not_found: "That connection was not found or is disconnected.",
};
const friendly = (code: string) => FRIENDLY[code] ?? "The request could not be completed.";

export type StripeMode = "test" | "live";

const KEY_PREFIX: Record<StripeMode, string> = { test: "sk_test_", live: "sk_live_" };
const MODE_LABEL: Record<StripeMode, string> = { test: "test", live: "live" };

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

export interface StripeCredentialResult extends StripeActionResult {
  verified: boolean;
  healthStatus?: ConnectorConnectionStatus;
  reasons?: string[];
}

/**
 * Stores this connection's test/live mode, saves its secret key, then
 * immediately calls the connector's own `verifyInstallation()` (a real
 * `GET /v1/balance` against Stripe) and persists the result — "saved" and
 * "verified" are always one action, never two separate steps a reviewer
 * could mistake for each other.
 */
async function saveAndVerify(
  identity: { tenant: { tenantId: string }; userId: string },
  connectionId: string,
  mode: StripeMode,
  plaintextSecret: string,
): Promise<StripeCredentialResult> {
  if (!plaintextSecret.startsWith(KEY_PREFIX[mode])) {
    return {
      ok: false,
      verified: false,
      error: `That doesn't look like a ${MODE_LABEL[mode]}-mode secret key — it should start with "${KEY_PREFIX[mode]}".`,
    };
  }

  const configResult = await updateConnectorConnectionConfig({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId,
    config: { mode },
  });
  if (configResult !== "ok") {
    revalidatePath(PAGE);
    return { ok: false, verified: false, error: friendly(configResult) };
  }

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

  const health = await stripeConnector.verifyInstallation({ connectionId });
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
    message:
      "Saved, but Stripe didn't accept this key — check it has the required permissions and try again.",
  };
}

export async function createStripeConnectionAction(
  name: string,
  mode: StripeMode,
  plaintextSecret: string,
): Promise<StripeCredentialResult> {
  // Validated before creating anything: a mode/key mismatch must never leave
  // behind an empty, orphaned connection row that then blocks reconnecting
  // (connector_connections allows only one non-disconnected row per connector).
  if (!plaintextSecret.startsWith(KEY_PREFIX[mode])) {
    return {
      ok: false,
      verified: false,
      error: `That doesn't look like a ${MODE_LABEL[mode]}-mode secret key — it should start with "${KEY_PREFIX[mode]}".`,
    };
  }
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const created = await createConnectorConnection({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectorId: STRIPE_CONNECTOR_ID,
    name,
    environment: "development",
  });
  if (created.status !== "ok" || !created.connectionId) {
    return { ok: false, verified: false, error: friendly(created.status) };
  }
  return saveAndVerify(identity, created.connectionId, mode, plaintextSecret);
}

/** Rotates an existing connection's key (and/or mode) and re-verifies in the same step. */
export async function setStripeSecretAction(
  connectionId: string,
  mode: StripeMode,
  plaintextSecret: string,
): Promise<StripeCredentialResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  return saveAndVerify(identity, connectionId, mode, plaintextSecret);
}

/** Re-runs the health check against the already-saved key, without rotating it — e.g. after fixing permissions on the Stripe side. */
export async function verifyStripeConnectionAction(connectionId: string): Promise<StripeCredentialResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const health = await stripeConnector.verifyInstallation({ connectionId });
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
        message: "Verification failed — check the key and its permissions on Stripe's side.",
      };
}

export async function disconnectStripeConnectionAction(connectionId: string): Promise<StripeActionResult> {
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
