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

/**
 * Starts the Gmail OAuth flow for one already-created `connector_connections`
 * row. A plain form POST (not a server action), mirroring
 * src/app/api/github/connect/route.ts exactly, for the same reason: the
 * response must redirect the browser to another origin while setting the
 * single-use state and PKCE cookies.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = "/app/integrations/gmail";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const base = publicBaseUrl() ?? request.nextUrl.origin;
  const fail = (code: string) =>
    NextResponse.redirect(new URL(`${PAGE}?error=${encodeURIComponent(code)}`, base), 303);

  const sent = request.headers.get("origin");
  if (sent && sent !== base) return fail("forbidden");

  const { context } = await createRepositoriesForCurrentTenant(PAGE);
  const form = await request.formData().catch(() => null);
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
  return response;
}
