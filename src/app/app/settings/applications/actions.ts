"use server";

import { revalidatePath } from "next/cache";

import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { RepositoryError } from "@/lib/persistence/errors";

/**
 * Server actions for developer applications, backend credentials and
 * connection delegation. Every RPC here runs through `context.supabase.rpc`
 * -- the caller's own authenticated Supabase session, not the gateway pool
 * -- so `auth.uid()` inside each function resolves to a real signed-in
 * dashboard administrator. This is deliberate: a backend credential must be
 * issuable only by a human admin acting through this dashboard, never
 * implied by a raw database session (see 20261003000002's own module
 * comment on why this credential space is kept separate from an agent
 * runtime key).
 */

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function presentActionError(error: unknown): string {
  if (error instanceof RepositoryError) return error.message;
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}

const APPLICATIONS_PATH = "/app/settings/applications";

export interface NewApplication {
  applicationId: string;
}

export async function createApplicationAction(
  name: string,
  slug: string,
  environment: "development" | "staging" | "production",
): Promise<ActionResult<NewApplication>> {
  try {
    const { identity, context } = await createRepositoriesForCurrentTenant(APPLICATIONS_PATH);
    const { data, error } = await context.supabase.rpc("create_application", {
      p_tenant_id: identity.tenant.tenantId,
      p_name: name,
      p_slug: slug,
      p_environment: environment,
    });
    if (error) return { ok: false, error: error.message };
    const row = data?.[0];
    if (!row || row.app_status !== "ok" || !row.app_application_id) {
      return {
        ok: false,
        error: row?.app_status === "forbidden" ? "Admin role required." : "Could not create the application.",
      };
    }
    revalidatePath(APPLICATIONS_PATH);
    return { ok: true, data: { applicationId: row.app_application_id } };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export interface NewBackendCredential {
  credentialId: string;
  keyPrefix: string;
  plaintextSecret: string;
}

export async function createBackendCredentialAction(
  applicationId: string,
  name: string,
): Promise<ActionResult<NewBackendCredential>> {
  try {
    const { context } = await createRepositoriesForCurrentTenant(`${APPLICATIONS_PATH}/${applicationId}`);
    const { data, error } = await context.supabase.rpc("create_backend_credential", {
      p_application_id: applicationId,
      // The RPC itself treats an empty string identically to SQL NULL
      // (`nullif(btrim(coalesce(p_name, '')), '')`), so this never changes
      // behavior -- it only satisfies the generated Args type, which (unlike
      // a table column's nullability) doesn't know this parameter accepts
      // NULL at the SQL level.
      p_name: name,
    });
    if (error) return { ok: false, error: error.message };
    const row = data?.[0];
    if (!row) return { ok: false, error: "No credential was returned." };
    revalidatePath(`${APPLICATIONS_PATH}/${applicationId}`);
    return {
      ok: true,
      data: {
        credentialId: row.credential_id,
        keyPrefix: row.key_prefix,
        plaintextSecret: row.plaintext_secret,
      },
    };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export async function revokeBackendCredentialAction(
  applicationId: string,
  credentialId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const { context } = await createRepositoriesForCurrentTenant(`${APPLICATIONS_PATH}/${applicationId}`);
    const { error } = await context.supabase.rpc("revoke_backend_credential", {
      p_credential_id: credentialId,
      p_reason: reason,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`${APPLICATIONS_PATH}/${applicationId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export async function updateApplicationReturnUrlsAction(
  applicationId: string,
  returnUrls: string[],
): Promise<ActionResult> {
  try {
    const { context } = await createRepositoriesForCurrentTenant(`${APPLICATIONS_PATH}/${applicationId}`);
    const { data, error } = await context.supabase.rpc("update_application_return_urls", {
      p_application_id: applicationId,
      p_return_urls: returnUrls,
    });
    if (error) return { ok: false, error: error.message };
    if (data !== "ok") {
      const messages: Record<string, string> = {
        forbidden: "Admin role required.",
        not_found: "Application not found.",
        too_many_urls: "At most 20 return URLs are allowed.",
        invalid_url: "Every return URL must be a full http(s) URL.",
      };
      return { ok: false, error: messages[data as string] ?? "Could not update return URLs." };
    }
    revalidatePath(`${APPLICATIONS_PATH}/${applicationId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export interface NewConnectionBroker {
  brokerId: string;
}

export async function createConnectionBrokerAction(
  applicationId: string,
  url: string,
  sharedSecret: string,
): Promise<ActionResult<NewConnectionBroker>> {
  try {
    const { context } = await createRepositoriesForCurrentTenant(`${APPLICATIONS_PATH}/${applicationId}`);
    const { data, error } = await context.supabase.rpc("create_connection_broker", {
      p_application_id: applicationId,
      p_url: url,
      p_shared_secret: sharedSecret,
    });
    if (error) return { ok: false, error: error.message };
    const row = data?.[0];
    if (!row || row.cb_status !== "ok" || !row.cb_broker_id) {
      const messages: Record<string, string> = {
        forbidden: "Admin role required.",
        invalid_url: "The broker URL must be a full https:// URL.",
        invalid_secret: "The shared secret must be 32-512 characters.",
      };
      return { ok: false, error: messages[row?.cb_status ?? ""] ?? "Could not register the broker." };
    }
    revalidatePath(`${APPLICATIONS_PATH}/${applicationId}`);
    return { ok: true, data: { brokerId: row.cb_broker_id } };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export async function revokeConnectionBrokerAction(
  applicationId: string,
  brokerId: string,
): Promise<ActionResult> {
  try {
    const { context } = await createRepositoriesForCurrentTenant(`${APPLICATIONS_PATH}/${applicationId}`);
    const { data, error } = await context.supabase.rpc("revoke_connection_broker", { p_broker_id: brokerId });
    if (error) return { ok: false, error: error.message };
    if (data !== "ok") {
      return { ok: false, error: data === "forbidden" ? "Admin role required." : "Broker not found." };
    }
    revalidatePath(`${APPLICATIONS_PATH}/${applicationId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export async function grantConnectionDelegationAction(
  applicationId: string,
  connectionId: string,
  customerId: string,
): Promise<ActionResult> {
  try {
    const { context } = await createRepositoriesForCurrentTenant(`${APPLICATIONS_PATH}/${applicationId}`);
    const { data, error } = await context.supabase.rpc("grant_connection_delegation", {
      p_connection_id: connectionId,
      p_customer_id: customerId,
    });
    if (error) return { ok: false, error: error.message };
    if (data !== "ok") {
      const messages: Record<string, string> = {
        forbidden: "Admin role required.",
        connection_not_found: "Connection not found.",
        connection_not_organization_owned: "Only an organization-owned connection can be delegated.",
        customer_not_found: "Customer not found.",
      };
      return { ok: false, error: messages[data as string] ?? "Could not grant delegation." };
    }
    revalidatePath(`${APPLICATIONS_PATH}/${applicationId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}

export async function revokeConnectionDelegationAction(
  applicationId: string,
  connectionId: string,
  customerId: string,
): Promise<ActionResult> {
  try {
    const { context } = await createRepositoriesForCurrentTenant(`${APPLICATIONS_PATH}/${applicationId}`);
    const { data, error } = await context.supabase.rpc("revoke_connection_delegation", {
      p_connection_id: connectionId,
      p_customer_id: customerId,
    });
    if (error) return { ok: false, error: error.message };
    if (data !== "ok") {
      return { ok: false, error: data === "forbidden" ? "Admin role required." : "Delegation not found." };
    }
    revalidatePath(`${APPLICATIONS_PATH}/${applicationId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}
