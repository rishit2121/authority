"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "@/lib/env";

import type { Database } from "./database.types";

/**
 * Browser client, for Client Components only.
 *
 * Holds the publishable key and nothing else. There is no service-role client
 * anywhere in this codebase — not here, not on the server — so no code path
 * exists that could bypass row level security.
 *
 * `createBrowserClient` memoizes internally, so calling this per component is
 * cheap and does not create competing auth listeners.
 */
export function createClient() {
  const { url, publishableKey } = getSupabaseEnv();
  return createBrowserClient<Database>(url, publishableKey);
}
