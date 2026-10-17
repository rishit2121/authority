import "server-only";

import type { createClient } from "@/lib/supabase/server";

/**
 * The verified caller's pilot standing, decided in the database from
 * auth.users (confirmed email) and pilot_access -- never from a submitted
 * email, URL parameter, claim or user metadata.
 */

export type PilotAccess = "eligible" | "not_approved" | "unconfirmed" | "unauthenticated";

export interface PilotViewer {
  access: PilotAccess;
  /** The verified platform owner (pilot_settings.owner_email). */
  isOwner: boolean;
  gateEnabled: boolean;
}

export const INVITE_ONLY_PATH = "/invite-only";

/** Raised when the check itself fails. Callers fail closed. */
export class PilotCheckError extends Error {
  constructor(code: string) {
    super(`Could not check pilot access (${code}).`);
    this.name = "PilotCheckError";
  }
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function loadPilotViewer(supabase: SupabaseServerClient): Promise<PilotViewer> {
  const { data, error } = await supabase.rpc("pilot_viewer");
  if (error) throw new PilotCheckError(error.code ?? "unknown");
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) throw new PilotCheckError("empty");
  return {
    access: row.pv_access as PilotAccess,
    isOwner: row.pv_is_owner === true,
    gateEnabled: row.pv_gate_enabled === true,
  };
}
