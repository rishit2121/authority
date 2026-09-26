"use server";

import { revalidatePath } from "next/cache";

import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { RepositoryError } from "@/lib/persistence/errors";

/**
 * Server actions for agent runtime credentials.
 *
 * `create_agent_credential()`/`revoke_agent_credential()` do the real
 * authorization and tenant-membership checks (see the migration); these
 * wrappers only shape the result for the UI and revalidate the page.
 * `createAgentCredentialAction`'s plaintext secret is returned exactly once
 * in this response — it is never persisted, never logged, and this is the
 * only code path in the whole application that ever sees it.
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

export interface NewCredential {
  credentialId: string;
  keyPrefix: string;
  plaintextSecret: string;
}

export async function createAgentCredentialAction(agentId: string): Promise<ActionResult<NewCredential>> {
  try {
    const { context } = await createRepositoriesForCurrentTenant(`/app/agents/${agentId}`);

    const { data, error } = await context.supabase.rpc("create_agent_credential", { p_agent_id: agentId });
    if (error) return { ok: false, error: error.message };

    const row = data?.[0];
    if (!row) return { ok: false, error: "No credential was returned." };

    revalidatePath(`/app/agents/${agentId}`);
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

export async function revokeAgentCredentialAction(
  agentId: string,
  credentialId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const { context } = await createRepositoriesForCurrentTenant(`/app/agents/${agentId}`);

    const { error } = await context.supabase.rpc("revoke_agent_credential", {
      p_credential_id: credentialId,
      p_reason: reason,
    });
    if (error) return { ok: false, error: error.message };

    revalidatePath(`/app/agents/${agentId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: presentActionError(error) };
  }
}
