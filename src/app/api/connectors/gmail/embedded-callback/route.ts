import { NextResponse, type NextRequest } from "next/server";

import {
  EMBEDDED_GMAIL_PKCE_COOKIE,
  EMBEDDED_GMAIL_STATE_COOKIE,
} from "@/app/connect/embedded-gmail-cookies";
import {
  exchangeGmailOAuthCode,
  fetchGmailAccountEmail,
  parseGmailOAuthState,
  validGmailNonce,
} from "@/lib/connectors/gmail/oauth";
import { publicBaseUrl } from "@/lib/connectors/shared/public-base-url";
import { completeEmbeddedConnection, resolveConnectionSession } from "@/lib/gateway/rpc-connection-sessions";

/**
 * Google's redirect target for the embedded ("Mode A") Gmail connect flow --
 * the session-token counterpart of the dashboard's own
 * `/api/connectors/gmail/callback`, reusing the exact same exchange
 * (`exchangeGmailOAuthCode`) and account-label lookup (`fetchGmailAccountEmail`)
 * code. The one real difference: there is no dashboard session or admin
 * here, so the result is written through `gateway.complete_embedded_connection`
 * (authorized by the session token itself) instead of `setConnectorSecret`
 * (authorized by a signed-in admin).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const origin = (request: NextRequest) => publicBaseUrl() ?? request.nextUrl.origin;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const cookieNonce = request.cookies.get(EMBEDDED_GMAIL_STATE_COOKIE)?.value;
  const cookieVerifier = request.cookies.get(EMBEDDED_GMAIL_PKCE_COOKIE)?.value;

  const finish = (target: URL | string) => {
    const response = NextResponse.redirect(target instanceof URL ? target : new URL(target, origin(request)));
    response.cookies.delete({ name: EMBEDDED_GMAIL_STATE_COOKIE, path: "/api/connectors/gmail" });
    response.cookies.delete({ name: EMBEDDED_GMAIL_PKCE_COOKIE, path: "/api/connectors/gmail" });
    return response;
  };
  const fail = (reason: string) => finish(`/connect/error?reason=${encodeURIComponent(reason)}`);

  if (!cookieNonce || !validGmailNonce(cookieNonce) || !cookieVerifier) return fail("not_started_here");

  const state = parseGmailOAuthState(params.get("state"));
  if (!state || state.nonce !== cookieNonce || !state.sessionToken) return fail("invalid_state");
  const sessionToken = state.sessionToken;

  // Re-resolve the session: confirms it is still pending/not expired right
  // now (not just when /connect/[token] first redirected here), and gives
  // us the allowlisted return URL to send the browser back to.
  let session: Awaited<ReturnType<typeof resolveConnectionSession>>;
  try {
    session = await resolveConnectionSession(sessionToken);
  } catch {
    return fail("connection_unavailable");
  }
  if (session.status !== "ok" || !session.returnUrl) return fail("session_not_found_or_expired");

  const code = params.get("code");
  if (!code) return fail(params.get("error") ?? "oauth_denied");

  try {
    const exchanged = await exchangeGmailOAuthCode({
      code,
      redirectUri: `${origin(request)}/api/connectors/gmail/embedded-callback`,
      verifier: cookieVerifier,
    });

    // Unlike the dashboard flow, the connected account's identity is not
    // cosmetic here -- it is the uniqueness key a customer-owned connection
    // is created under, so a failure to resolve it is a hard failure, not a
    // best-effort label.
    const email = await fetchGmailAccountEmail(exchanged.accessToken);
    if (!email) return fail("could_not_verify_account");

    const result = await completeEmbeddedConnection({
      sessionToken,
      secretType: "oauth_refresh_token",
      plaintextSecret: exchanged.refreshToken,
      verifiedAccountRef: email,
    });
    if (result.status !== "ok") return fail(result.status);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "oauth_exchange_failed");
  }

  const target = new URL(session.returnUrl);
  target.searchParams.set("connection_session_id", session.sessionId ?? "");
  return finish(target);
}
