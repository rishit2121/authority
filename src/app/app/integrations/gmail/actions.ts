"use server";

import { revalidatePath } from "next/cache";

import { GMAIL_CONNECTOR_ID } from "@/lib/connectors/gmail/connector";
import { createConnectorConnection, disconnectConnectorConnection } from "@/lib/gateway/rpc-connectors";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export interface GmailActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const PAGE = "/app/integrations/gmail";

const FRIENDLY: Record<string, string> = {
  forbidden: "Your role does not allow this. An admin is required.",
  already_connected: "A connection with that id already exists.",
  not_found: "That record was not found.",
  connection_not_found: "That connection was not found or is disconnected.",
};
const friendly = (code: string) => FRIENDLY[code] ?? "The request could not be completed.";

export async function createGmailConnectionAction(
  name: string,
  environment: "development" | "staging" | "production",
): Promise<GmailActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const created = await createConnectorConnection({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectorId: GMAIL_CONNECTOR_ID,
    name,
    environment,
  });
  revalidatePath(PAGE);
  if (created.status !== "ok") return { ok: false, error: friendly(created.status) };
  return { ok: true, message: "Connection created. Click “Connect with Google” below." };
}

export async function disconnectGmailConnectionAction(connectionId: string): Promise<GmailActionResult> {
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
