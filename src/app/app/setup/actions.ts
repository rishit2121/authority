"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { publicBaseUrl } from "@/lib/connectors/shared/public-base-url";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { buildTenantRegistry } from "@/lib/registry";
import { autoRunnableReadTools, type SetupEnv } from "@/lib/setup/quick-setup";

export interface QuickSetupResult {
  ok: boolean;
  error?: string;
  data?: { agentId: string; applicationId: string; env: SetupEnv; autoRunTools: string[] };
}

const inputSchema = z.object({
  agentName: z.string().trim().min(1, "Give your agent a name.").max(200),
  connectionIds: z.array(z.string().uuid()).max(50),
  autoRunReads: z.boolean(),
});

const SETUP_PATH = "/app/setup";

/**
 * Everything the developer journey needs before the first line of code, in
 * one admin action: an application (reused if one exists), an agent, the
 * chosen connections opened to that application's customers, read-only
 * tools allow-listed for automatic activation (optional), then the two
 * keys. Each step goes through the same RLS-checked RPC the individual
 * advanced pages use -- this composes them, it never bypasses one.
 *
 * Keys are minted last so a failure in any earlier step never produces a
 * secret the user didn't get to see. Plaintext secrets exist only in this
 * response; nothing here persists or logs them.
 */
export async function runQuickSetupAction(input: {
  agentName: string;
  connectionIds: string[];
  autoRunReads: boolean;
}): Promise<QuickSetupResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { agentName, connectionIds, autoRunReads } = parsed.data;

  const { identity, context } = await createRepositoriesForCurrentTenant(SETUP_PATH);
  const tenantId = identity.tenant.tenantId;
  if (!tenantId || !["owner", "admin"].includes(identity.role)) {
    return { ok: false, error: "Only a workspace owner or admin can run setup." };
  }
  const db = context.supabase;

  const baseUrl = publicBaseUrl();
  if (!baseUrl) return { ok: false, error: "This deployment has no public URL configured." };

  const { data: principalId, error: principalError } = await db.rpc(
    "ensure_human_principal_for_current_user",
    { p_tenant_id: tenantId },
  );
  if (principalError || !principalId) return { ok: false, error: "Could not resolve your workspace member." };

  let connections: Array<{ id: string; connector_id: string }> = [];
  if (connectionIds.length > 0) {
    const { data, error } = await db
      .from("connector_connections")
      .select("id, connector_id")
      .in("id", connectionIds)
      .eq("owner_kind", "organization")
      .neq("status", "disconnected");
    if (error) return { ok: false, error: "Could not read your connections." };
    connections = data ?? [];
  }
  if (connections.length !== new Set(connectionIds).size) {
    return {
      ok: false,
      error: "One of the selected connections is no longer available. Refresh and try again.",
    };
  }

  const { data: existingApps } = await db
    .from("applications")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1);
  let applicationId = existingApps?.[0]?.id as string | undefined;
  if (!applicationId) {
    const { data, error } = await db.rpc("create_application", {
      p_tenant_id: tenantId,
      p_name: "My app",
      p_slug: `app-${randomBytes(3).toString("hex")}`,
      p_environment: "production",
    });
    const row = data?.[0];
    if (error || !row || row.app_status !== "ok" || !row.app_application_id) {
      return { ok: false, error: "Could not create your application." };
    }
    applicationId = row.app_application_id;
  }

  const { data: agent, error: agentError } = await db
    .from("agents")
    .insert({
      tenant_id: tenantId,
      name: agentName,
      model: "unspecified",
      model_provider: "unspecified",
      framework: "unspecified",
      owner_principal_id: principalId,
    })
    .select("id")
    .single();
  if (agentError || !agent) return { ok: false, error: "Could not create the agent." };

  for (const { id: connectionId } of connections) {
    const { data, error } = await db.rpc("set_application_connection_access_policy", {
      p_application_id: applicationId,
      p_connection_id: connectionId,
      p_scope: "application_shared",
      // Nullable at the SQL level (no expiry); the generated type is overly strict.
      p_max_grant_seconds: null as unknown as number,
    });
    if (error || data !== "ok") return { ok: false, error: "Could not share a connection with your app." };
  }

  let autoRunTools: string[] = [];
  if (autoRunReads && connections.length > 0) {
    const registry = await buildTenantRegistry(tenantId);
    autoRunTools = autoRunnableReadTools(
      registry.operations.values(),
      connections.map((c) => c.connector_id),
    );
    const { data: existing } = await db
      .from("automation_policies")
      .select("tool")
      .eq("application_id", applicationId)
      .is("revoked_at", null);
    const already = new Set((existing ?? []).map((p) => p.tool));
    for (const tool of autoRunTools.filter((t) => !already.has(t))) {
      const { data, error } = await db.rpc("create_automation_policy", {
        p_application_id: applicationId,
        p_tool: tool,
      });
      if (error || data?.[0]?.cap_status !== "ok") {
        return { ok: false, error: "Could not turn on automatic read-only tools." };
      }
    }
  }

  const { data: backendKey, error: backendKeyError } = await db.rpc("create_backend_credential", {
    p_application_id: applicationId,
    p_name: `Setup: ${agentName}`.slice(0, 100),
  });
  const { data: agentKey, error: agentKeyError } = await db.rpc("create_agent_credential", {
    p_agent_id: agent.id,
  });
  const backendRow = backendKey?.[0];
  const agentRow = agentKey?.[0];
  if (backendKeyError || agentKeyError || !backendRow || !agentRow) {
    return { ok: false, error: "Could not issue your keys. Try again from the agent's page." };
  }

  revalidatePath(SETUP_PATH);
  revalidatePath("/app");
  revalidatePath("/app/agents");

  return {
    ok: true,
    data: {
      agentId: agent.id,
      applicationId,
      autoRunTools,
      env: {
        AUTHORITY_URL: baseUrl,
        AUTHORITY_BACKEND_API_KEY: backendRow.plaintext_secret,
        AUTHORITY_AGENT_ID: agent.id,
        AUTHORITY_AGENT_RUNTIME_KEY: agentRow.plaintext_secret,
      },
    },
  };
}
