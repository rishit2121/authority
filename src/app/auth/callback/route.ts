import { NextResponse, type NextRequest } from "next/server";

import { DEFAULT_AUTHENTICATED_PATH, safeReturnPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Email link callback: confirmation, recovery and magic-link style codes.
 *
 * Supabase sends the user here with a `code` to exchange for a session. Two
 * things matter for safety:
 *
 *  1. The onward destination passes through `safeReturnPath`, so a crafted
 *     `next` parameter in a forwarded email link cannot turn this endpoint
 *     into an open redirect.
 *  2. A failed exchange lands on an auth page with a neutral message rather
 *     than surfacing the provider error, which can distinguish an expired code
 *     from an unknown one.
 */
/**
 * Relative redirect, resolved by the browser against the origin it requested.
 *
 * `request.nextUrl.origin` reports Next's configured hostname rather than the
 * one the client used, so an absolute URL built from it can cross origins and
 * drop the session cookies this handler just set.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const code = searchParams.get("code");
  const type = searchParams.get("type");
  const isRecovery = type === "recovery";

  // Supabase's own error passthrough, e.g. an expired link.
  const providerError = searchParams.get("error") ?? searchParams.get("error_code");

  if (providerError) {
    return redirectTo(isRecovery ? "/reset-password" : "/login");
  }

  if (!code) {
    return redirectTo("/login");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Deliberately coarse: the user is told the link did not work, and the
    // provider's reason is not echoed back through a query parameter.
    return redirectTo(isRecovery ? "/reset-password" : "/login");
  }

  // A recovery session must land on the password form, not the dashboard, or
  // the reset silently completes without a new password being set.
  if (isRecovery) {
    return redirectTo("/reset-password");
  }

  return redirectTo(safeReturnPath(searchParams.get("next"), DEFAULT_AUTHENTICATED_PATH));
}
