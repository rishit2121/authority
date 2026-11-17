"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { publicBaseUrl } from "@/lib/connectors/shared/public-base-url";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { runFirstCall, setupTaskKey, type FirstCallResult } from "@/lib/setup/first-call";
import type { SetupEnv } from "@/lib/setup/quick-setup";
import {
  readCallFor,
  SETUP_AGENT_FRAMEWORK,
  SETUP_AGENT_NAME,
  setupCustomerExternalId,
} from "@/lib/setup/state";

/**
 * The guided Setup page's server actions. Every one re-reads the caller's identity and role on the server and
 * re-validates every id it is given against the caller's tenant through RLS -- nothing the browser sends is trusted.
 * Each change goes through the same admin RPC the advanced pages use; none widens access on its own:
 *
 *  - `shareWithTestCustomerAction`  -> grant_connection_delegation, for ONE customer (the setup customer).
 *  - `shareWithEveryCustomerAction` -> set_application_connection_access_policy('application_shared'), only after
 *    an explicit confirmation in the browser, and never as a side effect of anything else.
 *  - `makeProtectedCallAction`      -> mints a backend key and a runtime key, then runs one real read call.
 *
 * Plaintext keys exist only in the response of the action that minted them; nothing here stores or logs them.
 */

const SETUP_PATH = "/app/setup";
const ADMIN_ROLES = new Set(["owner", "admin"]);

type Db = Awaited<ReturnType<typeof createRepositoriesForCurrentTenant>>["context"]["supabase"];

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const uuid = z.string().uuid();

async function adminContext() {
  const { identity, context } = await createRepositoriesForCurrentTenant(SETUP_PATH);
  const tenantId = identity.tenant.tenantId;
  if (!tenantId || !ADMIN_ROLES.has(identity.role)) return null;
  return { identity, tenantId, db: context.supabase };
}

const FORBIDDEN = { ok: false, error: "Only a workspace owner or admin can do this." } as const;

async function loadApplication(db: Db, applicationId: string) {
  if (!uuid.safeParse(applicationId).success) return null;
  // RLS: a row is returned only for an application in the caller's own tenant.
  const { data } = await db
    .from("applications")
    .select("id, name, tenant_id")
    .eq("id", applicationId)
    .maybeSingle();
  return data;
}

async function loadOrgConnection(db: Db, connectionId: string) {
  if (!uuid.safeParse(connectionId).success) return null;
  const { data } = await db
    .from("connector_connections")
    .select("id, connector_id, name, status, owner_kind, tenant_id")
    .eq("id", connectionId)
    .eq("owner_kind", "organization")
    .neq("status", "disconnected")
    .maybeSingle();
  return data;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------------------------------------------

export async function createSetupApplicationAction(input: {
  name: string;
}): Promise<ActionResult<{ applicationId: string }>> {
  const parsed = z
    .object({ name: z.string().trim().min(1, "Give your app a name.").max(100) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name." };
  const ctx = await adminContext();
  if (!ctx) return FORBIDDEN;

  const slugBase = parsed.data.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const { data, error } = await ctx.db.rpc("create_application", {
    p_tenant_id: ctx.tenantId,
    p_name: parsed.data.name,
    p_slug: `${slugBase || "app"}-${randomBytes(3).toString("hex")}`,
    p_environment: "production",
  });
  const row = data?.[0];
  if (error || !row || row.app_status !== "ok" || !row.app_application_id) {
    return { ok: false, error: "Could not create your app." };
  }
  revalidatePath(SETUP_PATH);
  return { ok: true, data: { applicationId: row.app_application_id } };
}

// ---------------------------------------------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------------------------------------------

/**
 * The setup customer for (this user, this application). There is no dashboard RPC that creates a customer, so the
 * first time one is needed a short-lived backend key for this application is minted, used once against this
 * deployment's own POST /api/v1/customers, and revoked immediately -- it is never shown or stored.
 */
async function ensureSetupCustomer(
  db: Db,
  application: { id: string; name: string },
  userId: string,
): Promise<{ customerId: string } | { error: string }> {
  const externalId = setupCustomerExternalId(userId);
  const { data: existing } = await db
    .from("customers")
    .select("id")
    .eq("application_id", application.id)
    .eq("external_id", externalId)
    .maybeSingle();
  if (existing) return { customerId: existing.id };

  const baseUrl = publicBaseUrl();
  if (!baseUrl) return { error: "This deployment has no public URL configured." };
  const { data: key, error: keyError } = await db.rpc("create_backend_credential", {
    p_application_id: application.id,
    p_name: `Setup: ${application.name} (test customer, revoked after use)`.slice(0, 100),
  });
  const credential = key?.[0];
  if (keyError || !credential) return { error: "Could not create your test customer." };
  try {
    const response = await fetch(`${baseUrl}/api/v1/customers`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential.plaintext_secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ externalId, displayLabel: "Setup test customer" }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
      redirect: "error",
    });
    const body = (await response.json().catch(() => ({}))) as { customerId?: unknown };
    if (!response.ok || typeof body.customerId !== "string") {
      return { error: "Could not create your test customer." };
    }
    return { customerId: body.customerId };
  } catch {
    return { error: "Could not reach this deployment's API to create your test customer." };
  } finally {
    await db.rpc("revoke_backend_credential", {
      p_credential_id: credential.credential_id,
      p_reason: "setup: used once to create the test customer",
    });
  }
}

/** Grants this ONE connection to this ONE customer (the setup customer). Nobody else gains anything. */
export async function shareWithTestCustomerAction(input: {
  applicationId: string;
  connectionId: string;
}): Promise<ActionResult> {
  const ctx = await adminContext();
  if (!ctx) return FORBIDDEN;
  const application = await loadApplication(ctx.db, input.applicationId);
  if (!application) return { ok: false, error: "That app was not found." };
  const connection = await loadOrgConnection(ctx.db, input.connectionId);
  if (!connection) return { ok: false, error: "That connection was not found or is disconnected." };

  const customer = await ensureSetupCustomer(ctx.db, application, ctx.identity.userId);
  if ("error" in customer) return { ok: false, error: customer.error };

  const { data, error } = await ctx.db.rpc("grant_connection_delegation", {
    p_connection_id: connection.id,
    p_customer_id: customer.customerId,
  });
  if (error || data !== "ok")
    return { ok: false, error: "Could not share the connection with your test customer." };
  revalidatePath(SETUP_PATH);
  return { ok: true };
}

/**
 * Opens this connection to EVERY customer of the application. Optional, never required by setup, and only after
 * the browser's explicit confirmation. Keeps the policy's existing grant lifetime.
 */
export async function shareWithEveryCustomerAction(input: {
  applicationId: string;
  connectionId: string;
  confirmed: boolean;
}): Promise<ActionResult> {
  if (input.confirmed !== true) return { ok: false, error: "Confirm before sharing with every customer." };
  const ctx = await adminContext();
  if (!ctx) return FORBIDDEN;
  const application = await loadApplication(ctx.db, input.applicationId);
  if (!application) return { ok: false, error: "That app was not found." };
  const connection = await loadOrgConnection(ctx.db, input.connectionId);
  if (!connection) return { ok: false, error: "That connection was not found or is disconnected." };

  const { data: policy } = await ctx.db
    .from("application_connection_access_policies")
    .select("max_grant_seconds")
    .eq("application_id", application.id)
    .eq("connection_id", connection.id)
    .maybeSingle();
  const { data, error } = await ctx.db.rpc("set_application_connection_access_policy", {
    p_application_id: application.id,
    p_connection_id: connection.id,
    p_scope: "application_shared",
    // Nullable at the SQL level (no expiry); the generated type is overly strict.
    p_max_grant_seconds: (policy?.max_grant_seconds ?? null) as number,
  });
  if (error || data !== "ok") return { ok: false, error: "Could not change who can use this connection." };
  revalidatePath(SETUP_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Keys and the protected call
// ---------------------------------------------------------------------------------------------------------------

async function ensureSetupAgent(db: Db, tenantId: string): Promise<{ agentId: string } | { error: string }> {
  const { data: principalId, error: principalError } = await db.rpc(
    "ensure_human_principal_for_current_user",
    {
      p_tenant_id: tenantId,
    },
  );
  if (principalError || !principalId) return { error: "Could not resolve your workspace member." };

  // Reuse the agent THIS user created in setup; never someone else's agent.
  const { data: existing } = await db
    .from("agents")
    .select("id")
    .eq("framework", SETUP_AGENT_FRAMEWORK)
    .eq("owner_principal_id", principalId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1);
  if (existing?.[0]) return { agentId: existing[0].id };

  const { data: agent, error } = await db
    .from("agents")
    .insert({
      tenant_id: tenantId,
      name: SETUP_AGENT_NAME,
      model: "unspecified",
      model_provider: "unspecified",
      framework: SETUP_AGENT_FRAMEWORK,
      owner_principal_id: principalId,
    })
    .select("id")
    .single();
  if (error || !agent) return { error: "Could not create the setup agent." };
  return { agentId: agent.id };
}

interface MintedKeys {
  env: SetupEnv;
  backendCredentialId: string;
  agentCredentialId: string;
}

async function mintKeys(
  db: Db,
  application: { id: string; name: string },
  agentId: string,
  baseUrl: string,
  name: string,
): Promise<MintedKeys | { error: string }> {
  const { data: backendKey, error: backendError } = await db.rpc("create_backend_credential", {
    p_application_id: application.id,
    p_name: name.slice(0, 100),
  });
  const backendRow = backendKey?.[0];
  if (backendError || !backendRow) return { error: "Could not issue a backend key." };
  const { data: agentKey, error: agentError } = await db.rpc("create_agent_credential", {
    p_agent_id: agentId,
  });
  const agentRow = agentKey?.[0];
  if (agentError || !agentRow) {
    await db.rpc("revoke_backend_credential", {
      p_credential_id: backendRow.credential_id,
      p_reason: "setup: runtime key could not be issued",
    });
    return { error: "Could not issue a runtime key." };
  }
  return {
    backendCredentialId: backendRow.credential_id,
    agentCredentialId: agentRow.credential_id,
    env: {
      AUTHORITY_URL: baseUrl,
      AUTHORITY_BACKEND_API_KEY: backendRow.plaintext_secret,
      AUTHORITY_AGENT_ID: agentId,
      AUTHORITY_AGENT_RUNTIME_KEY: agentRow.plaintext_secret,
    },
  };
}

async function revokeKeys(db: Db, keys: MintedKeys, reason: string) {
  await Promise.all([
    db.rpc("revoke_backend_credential", { p_credential_id: keys.backendCredentialId, p_reason: reason }),
    db.rpc("revoke_agent_credential", { p_credential_id: keys.agentCredentialId, p_reason: reason }),
  ]);
}

export interface ProtectedCallData {
  result: FirstCallResult;
  /** Shown once. Null when the attempt never reached authorize (the keys were revoked right away). */
  env: SetupEnv | null;
  /** True when this attemptId had already run: nothing was minted or sent again. */
  alreadyRan: boolean;
}

const callSchema = z.object({ applicationId: uuid, connectionId: uuid, attemptId: uuid });

export async function makeProtectedCallAction(input: {
  applicationId: string;
  connectionId: string;
  attemptId: string;
}): Promise<ActionResult<ProtectedCallData>> {
  const parsed = callSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const ctx = await adminContext();
  if (!ctx) return FORBIDDEN;
  const { db, tenantId, identity } = ctx;

  // (a) The app and the connection, both through RLS.
  const application = await loadApplication(db, parsed.data.applicationId);
  if (!application) return { ok: false, error: "That app was not found." };
  const connection = await loadOrgConnection(db, parsed.data.connectionId);
  if (!connection) return { ok: false, error: "That connection was not found or is disconnected." };
  const call = readCallFor(connection.connector_id);
  if (!call) return { ok: false, error: "This connector has no sample read call." };
  const baseUrl = publicBaseUrl();
  if (!baseUrl) return { ok: false, error: "This deployment has no public URL configured." };

  // A double submit of the same attempt: show what already happened, mint nothing, send nothing.
  const { data: earlier } = await db
    .from("tasks")
    .select("id, customer_id")
    .eq("idempotency_key", setupTaskKey(parsed.data.attemptId))
    .maybeSingle();
  if (earlier) {
    return {
      ok: true,
      data: {
        alreadyRan: true,
        env: null,
        result: {
          taskId: earlier.id,
          customerId: earlier.customer_id,
          decision: null,
          receiptId: null,
          outcome: "indeterminate",
          preparedStatus: null,
          summaryOfData: null,
          detail: "This attempt already ran. Its recorded decision and receipt are shown below.",
        },
      },
    };
  }

  // (b) The setup agent, (c) a fresh key pair. Plaintext stays in this function's memory.
  const agent = await ensureSetupAgent(db, tenantId);
  if ("error" in agent) return { ok: false, error: agent.error };
  const keys = await mintKeys(db, application, agent.agentId, baseUrl, `Setup: ${application.name}`);
  if ("error" in keys) return { ok: false, error: keys.error };

  // (d) The real runtime path, over HTTP, against this deployment.
  const result = await runFirstCall({
    baseUrl,
    backendKey: keys.env.AUTHORITY_BACKEND_API_KEY,
    runtimeKey: keys.env.AUTHORITY_AGENT_RUNTIME_KEY,
    agentId: agent.agentId,
    externalId: setupCustomerExternalId(identity.userId),
    call,
    connectionId: connection.id,
    attemptId: parsed.data.attemptId,
    fetch: (url, init) => fetch(url, init),
  });

  // Keys for an attempt that never reached authorize are revoked at once: the developer never saw them work.
  let env: SetupEnv | null = keys.env;
  if (!result.decision) {
    await revokeKeys(db, keys, `setup: attempt ended before authorize (${result.outcome})`);
    env = null;
  }

  revalidatePath(SETUP_PATH);
  revalidatePath("/app");
  return { ok: true, data: { result, env, alreadyRan: false } };
}

/** "Keys were shown once. Issue a new pair": only the key minting, for the setup agent and this app. */
export async function issueSetupKeysAction(input: {
  applicationId: string;
}): Promise<ActionResult<SetupEnv>> {
  const ctx = await adminContext();
  if (!ctx) return FORBIDDEN;
  const application = await loadApplication(ctx.db, input.applicationId);
  if (!application) return { ok: false, error: "That app was not found." };
  const baseUrl = publicBaseUrl();
  if (!baseUrl) return { ok: false, error: "This deployment has no public URL configured." };
  const agent = await ensureSetupAgent(ctx.db, ctx.tenantId);
  if ("error" in agent) return { ok: false, error: agent.error };
  const keys = await mintKeys(
    ctx.db,
    application,
    agent.agentId,
    baseUrl,
    `Setup: ${application.name} (issued ${today()})`,
  );
  if ("error" in keys) return { ok: false, error: keys.error };
  return { ok: true, data: keys.env };
}
