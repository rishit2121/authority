import { NextResponse, type NextRequest } from "next/server";

import {
  EMBEDDED_GMAIL_PKCE_COOKIE,
  EMBEDDED_GMAIL_STATE_COOKIE,
} from "@/app/connect/embedded-gmail-cookies";
import { startGmailOAuth } from "@/lib/connectors/gmail/oauth";
import { publicBaseUrl } from "@/lib/connectors/shared/public-base-url";
import { resolveConnectionSession } from "@/lib/gateway/rpc-connection-sessions";

/**
 * The opaque "connection URL" `POST /api/v1/connections/sessions` returns.
 * Alex's browser lands here directly from Acme's own redirect -- no
 * Authority credential, no dashboard login, nothing but this one token.
 * This route resolves the session, then (for the one provider wired to
 * Mode A so far, Gmail) redirects straight to that provider's consent
 * screen, carrying the session token through the state round-trip instead
 * of a connectionId -- no `connector_connections` row exists yet; one is
 * only created on successful exchange, by the embedded callback route.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_MAX_AGE_SECONDS = 15 * 60;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params;
  const base = publicBaseUrl() ?? request.nextUrl.origin;
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/connect/error?reason=${encodeURIComponent(reason)}`, base));

  const session = await resolveConnectionSession(token);
  if (session.status !== "ok" || !session.connectorId) return fail("session_not_found_or_expired");

  if (session.connectorId !== "gmail") {
    // Only Gmail is wired to Mode A's embedded OAuth flow in this pass; see
    // docs/connectors for which providers support an embedded connection
    // today versus requiring the dashboard-operated or broker path.
    return fail("provider_not_supported_for_embedded_connect");
  }

  const started = startGmailOAuth({
    sessionToken: token,
    redirectUri: `${base}/api/connectors/gmail/embedded-callback`,
  });
  if (started.status !== "ok" || !started.started) return fail(started.status);

  const response = NextResponse.redirect(started.started.authorizeUrl);
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && base.startsWith("https://"),
    path: "/api/connectors/gmail",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
  response.cookies.set(EMBEDDED_GMAIL_STATE_COOKIE, started.started.nonce, options);
  response.cookies.set(EMBEDDED_GMAIL_PKCE_COOKIE, started.started.verifier, options);
  return response;
}
