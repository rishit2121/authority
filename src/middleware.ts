import { NextResponse, type NextRequest } from "next/server";

import {
  DEFAULT_AUTHENTICATED_PATH,
  loginUrlFor,
  RETURN_PATH_PARAM,
  safeReturnPath,
} from "@/lib/auth/redirect";
import { refreshSession } from "@/lib/supabase/middleware";

/**
 * Session refresh and the route gate.
 *
 * Next.js 15 uses `middleware.ts`; Next 16 renamed the file to `proxy.ts` and
 * the export to `proxy`. This project is on 15.5.25, so the 15 convention
 * applies. Nothing here was carried over from an older Auth Helpers setup —
 * that package is deprecated and is not installed.
 *
 * What this file is and is not: it refreshes the session cookie on every
 * matched request and redirects obvious mismatches, which keeps an
 * unauthenticated user from ever rendering `/app`. It is *not* the
 * authorization boundary. `requireIdentity()` re-verifies the user server-side
 * on every protected page, because a matcher is a pattern and patterns have
 * edges.
 */

const PROTECTED_PREFIX = "/app";

/** Signed-in users have no use for these, so they are bounced to the app. */
const AUTH_ENTRY_ROUTES = ["/login", "/signup"];

function isProtected(pathname: string): boolean {
  return pathname === PROTECTED_PREFIX || pathname.startsWith(`${PROTECTED_PREFIX}/`);
}

function isAuthEntry(pathname: string): boolean {
  return AUTH_ENTRY_ROUTES.includes(pathname);
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Refresh first, unconditionally. Doing this before any redirect decision
  // means a request arriving with an expired-but-refreshable token is treated
  // as signed in rather than bounced to the login page.
  const { response, claims } = await refreshSession(request);

  const isSignedIn = claims !== null;

  if (!isSignedIn && isProtected(pathname)) {
    const target = loginUrlFor(`${pathname}${search}`);
    return redirectPreservingCookies(request, response, target);
  }

  if (isSignedIn && isAuthEntry(pathname)) {
    // Honour a pending return path so a signed-in user following a stale
    // /login?next=... link still lands where the link intended.
    const requested = request.nextUrl.searchParams.get(RETURN_PATH_PARAM);
    const target = safeReturnPath(requested, DEFAULT_AUTHENTICATED_PATH);
    return redirectPreservingCookies(request, response, target);
  }

  return response;
}

/**
 * Redirects without discarding the refreshed auth cookies.
 *
 * A bare `NextResponse.redirect` would drop the rotated Set-Cookie headers
 * that `refreshSession` just wrote, signing the user out precisely when their
 * token was renewed.
 */
function redirectPreservingCookies(
  request: NextRequest,
  refreshed: NextResponse,
  targetPath: string,
): NextResponse {
  const url = request.nextUrl.clone();
  const target = new URL(targetPath, request.nextUrl.origin);

  url.pathname = target.pathname;
  url.search = target.search;
  url.hash = "";

  const redirectResponse = NextResponse.redirect(url);

  for (const cookie of refreshed.cookies.getAll()) {
    redirectResponse.cookies.set(cookie);
  }

  return redirectResponse;
}

export const config = {
  /**
   * Everything except static assets and image files. The session must be
   * refreshed on marketing routes too, otherwise a user who idles on the
   * landing page and then clicks through to `/app` arrives with a stale token.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf|map)$).*)",
  ],
};
