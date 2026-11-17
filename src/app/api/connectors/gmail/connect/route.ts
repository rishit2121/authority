import { NextResponse, type NextRequest } from "next/server";

import { GMAIL_CONNECTOR_ID } from "@/lib/connectors/gmail/connector";
import {
  COOKIE_MAX_AGE_SECONDS,
  PKCE_COOKIE,
  startGmailOAuth,
  STATE_COOKIE,
} from "@/lib/connectors/gmail/oauth";
import { publicBaseUrl } from "@/lib/connectors/shared/public-base-url";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { RETURN_TO_COOKIE, safeReturnTo, sameOriginUrl, withQueryParam } from "@/lib/setup/return-to";

/**
 * Starts the Gmail OAuth flow for one already-created `connector_connections`
 * row. A plain form POST (not a server action), mirroring
 * src/app/api/github/connect/route.ts exactly, for the same reason: the
 * response must redirect the browser to another origin while setting the
 * single-use state and PKCE cookies.
 *
 * An optional `returnTo` form field (only a same-origin `/app/setup...` path; see safeReturnTo) is kept in an
 * httpOnly cookie beside the state cookie, so the callback can send the browser back to the Setup step it came
 * from. Without it, both routes keep returning to the Gmail page.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = "/app/integrations/gmail";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const base = publicBaseUrl() ?? request.nextUrl.origin;
  let returnTo: string | null = null;
  const fail = (code: string) =>
    NextResponse.redirect(
      sameOriginUrl(
        returnTo
          ? withQueryParam(returnTo, "connect_error", code)
          : `${PAGE}?error=${encodeURIComponent(code)}`,
        base,
        PAGE,
      ),
      303,
    );

  const sent = request.headers.get("origin");
  if (sent && sent !== base) return fail("forbidden");

  const { context } = await createRepositoriesForCurrentTenant(PAGE);
  const form = await request.formData().catch(() => null);
  returnTo = safeReturnTo(form?.get("returnTo"));
  const connectionId = form?.get("connectionId");
  if (typeof connectionId !== "string" || connectionId.length === 0) return fail("invalid_connection");

  // RLS scopes this to the caller's own tenant; a foreign or nonexistent
  // connection id returns no row, same as a cross-tenant lookup never
  // succeeding anywhere else in this app.
  const { data: connection } = await context.supabase
    .from("connector_connections")
    .select("id, connector_id, status")
    .eq("id", connectionId)
    .eq("connector_id", GMAIL_CONNECTOR_ID)
    .maybeSingle();
  if (!connection || connection.status === "disconnected") return fail("connection_not_found");

  const result = startGmailOAuth({ connectionId, redirectUri: `${base}/api/connectors/gmail/callback` });
  if (result.status !== "ok" || !result.started) return fail(result.status);

  const response = NextResponse.redirect(result.started.authorizeUrl, 303);
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && base.startsWith("https://"),
    path: "/api/connectors/gmail",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
  response.cookies.set(STATE_COOKIE, result.started.nonce, options);
  response.cookies.set(PKCE_COOKIE, result.started.verifier, options);
  // Always overwrite: a stale value from an abandoned Setup visit must never redirect a later connect.
  if (returnTo) response.cookies.set(RETURN_TO_COOKIE, returnTo, options);
  else response.cookies.delete({ name: RETURN_TO_COOKIE, path: "/api/connectors/gmail" });
  return response;
}
