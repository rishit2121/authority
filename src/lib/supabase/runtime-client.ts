import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "@/lib/env";

import type { Database } from "./database.types";

/**
 * A bare, session-less Supabase client for the runtime authorization
 * endpoint only.
 *
 * Every other server-side client in this codebase (`server.ts`) carries a
 * human's session out of cookies, because every other RPC trusts
 * `auth.uid()`. An agent calling `/api/v1/authorize` has no Supabase session
 * at all — it authenticates by presenting a raw secret as an *argument* to
 * `authorize_tool_call()`, which hashes and looks it up itself. That RPC is
 * granted to `anon`, deliberately, so this client only ever needs the public
 * publishable key — never a service-role credential — to reach it. Must not
 * be reused for anything that expects a signed-in user.
 */
export function createRuntimeClient() {
  const { url, publishableKey } = getSupabaseEnv();
  return createSupabaseClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
