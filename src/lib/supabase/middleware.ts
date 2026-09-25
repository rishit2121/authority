import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseEnv } from "@/lib/env";

import type { Database } from "./database.types";

/**
 * The session-refresh boundary.
 *
 * Next.js 15 names this entry point `middleware.ts`; version 16 renamed the
 * file to `proxy.ts` with an exported `proxy` function. This project is on
 * Next 15.5, so `middleware.ts` is correct here — see src/middleware.ts.
 *
 * Server Components cannot write cookies, so without this hop a refreshed
 * access token would be minted and then thrown away, and the user would be
 * signed out as soon as their token expired.
 */
export interface SessionRefreshResult {
  /**
   * Response carrying the rotated auth cookies. Any redirect must be built by
   * copying these cookies across, or the refresh is discarded.
   */
  response: NextResponse;
  /** Verified claims, or null when there is no valid session. */
  claims: { sub: string; email?: string } | null;
}

export async function refreshSession(request: NextRequest): Promise<SessionRefreshResult> {
  // Forwarded so a Server Component can learn which path was requested, which
  // is otherwise unavailable in a layout and is needed to build an accurate
  // post-login return path.
  request.headers.set("x-authority-path", `${request.nextUrl.pathname}${request.nextUrl.search}`);

  let response = NextResponse.next({ request });

  const { url, publishableKey } = getSupabaseEnv();

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Nothing may run between creating the client and this call. getClaims()
  // performs the token refresh as a side effect; inserting work before it
  // risks acting on an expired session, and inserting an early return risks
  // dropping the rotated cookies.
  //
  // getClaims() verifies the token rather than decoding it — locally against
  // the project's JWKS when asymmetric signing keys are enabled, otherwise via
  // the Auth server. getSession() is never used in server code: it reports
  // whatever the cookie says, verified or not.
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    return { response, claims: null };
  }

  const claims = data.claims as { sub: string; email?: string };

  return { response, claims: { sub: claims.sub, email: claims.email } };
}
