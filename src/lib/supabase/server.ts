import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";

import { getSupabaseEnv } from "@/lib/env";

import type { Database } from "./database.types";

/**
 * Server client, for Server Components, Server Actions and Route Handlers.
 *
 * Must be created per request — it closes over that request's cookie store, so
 * a module-level singleton would leak one user's session into another's
 * request.
 */
export async function createClient() {
  const { url, publishableKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. This is expected and
          // safe to swallow: the middleware in src/middleware.ts refreshes
          // the session and writes the rotated cookies on every request, so
          // nothing is lost by failing to persist them here.
        }
      },
    },
  });
}
