"use server";

import { revalidatePath } from "next/cache";

import { SLACK_CONNECTOR_ID } from "@/lib/connectors/slack/connector";
import { setConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";
import { createConnectorConnection, disconnectConnectorConnection } from "@/lib/gateway/rpc-connectors";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export interface SlackActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const PAGE = "/app/integrations/slack";

const FRIENDLY: Record<string, string> = {
  forbidden: "Your role does not allow this. An admin is required.",
  already_connected: "A connection with that id already exists.",
  not_found: "That record was not found.",
  connection_not_found: "That connection was not found or is disconnected.",
};
const friendly = (code: string) => FRIENDLY[code] ?? "The request could not be completed.";

export async function createSlackConnectionAction(
  name: string,
  environment: "development" | "staging" | "production",
): Promise<SlackActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const created = await createConnectorConnection({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectorId: SLACK_CONNECTOR_ID,
    name,
    environment,
  });
  revalidatePath(PAGE);
  if (created.status !== "ok") return { ok: false, error: friendly(created.status) };
  return { ok: true, message: "Connection created. Add its bot token below." };
}

export async function setSlackBotTokenAction(
  connectionId: string,
  plaintextSecret: string,
): Promise<SlackActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await setConnectorSecret({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId,
    secretType: "bearer_token",
    plaintextSecret,
  });
  revalidatePath(PAGE);
  return result === "ok" ? { ok: true, message: "Bot token saved." } : { ok: false, error: friendly(result) };
}

export async function disconnectSlackConnectionAction(connectionId: string): Promise<SlackActionResult> {
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
