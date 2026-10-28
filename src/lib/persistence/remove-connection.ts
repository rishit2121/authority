import "server-only";

import type { RepositoryContext } from "@/lib/persistence/context";

const MESSAGES: Record<string, string> = {
  forbidden: "Only admins and owners can remove a connection.",
  not_found: "That connection was not found.",
  not_disconnected: "Disconnect the connection before removing it.",
};

/**
 * Removes a disconnected connection from the dashboard (migration 20261028000002). It is archived, not deleted:
 * receipts and other history that reference it stay. The database enforces the role and the disconnected state.
 */
export async function removeConnection(
  context: RepositoryContext,
  connectionId: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const { data, error } = await context.supabase.rpc("remove_connector_connection", {
    p_connection_id: connectionId,
  });
  if (error) return { ok: false, error: "Could not remove the connection." };
  if (data !== "ok")
    return { ok: false, error: MESSAGES[data as string] ?? "Could not remove the connection." };
  return { ok: true, message: "Connection removed. Its history is kept." };
}
