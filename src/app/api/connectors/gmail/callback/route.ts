import { NextResponse, type NextRequest } from "next/server";

import { GMAIL_CONNECTOR_ID } from "@/lib/connectors/gmail/connector";
import {
  exchangeGmailOAuthCode,
  fetchGmailAccountEmail,
  parseGmailOAuthState,
  PKCE_COOKIE,
  STATE_COOKIE,
  validGmailNonce,
} from "@/lib/connectors/gmail/oauth";
import { publicBaseUrl } from "@/lib/connectors/shared/public-base-url";
import { setConnectorSecret, updateConnectorConnectionConfig } from "@/lib/gateway/rpc-connector-secrets";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = "/app/integrations/gmail";

const origin = (request: NextRequest) => publicBaseUrl() ?? request.nextUrl.origin;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { identity, context } = await createRepositoriesForCurrentTenant(PAGE);
  const params = request.nextUrl.searchParams;
  const cookieNonce = request.cookies.get(STATE_COOKIE)?.value;
  const cookieVerifier = request.cookies.get(PKCE_COOKIE)?.value;

  const finish = (target: string) => {
    const response = NextResponse.redirect(new URL(target, origin(request)));
    response.cookies.delete({ name: STATE_COOKIE, path: "/api/connectors/gmail" });
    response.cookies.delete({ name: PKCE_COOKIE, path: "/api/connectors/gmail" });
    return response;
  };
  const fail = (code: string) => finish(`${PAGE}?error=${encodeURIComponent(code)}`);

  // No state cookie at all: Google sent the user back without Authority
  // having started the flow in this browser. Nothing is mapped.
  if (!cookieNonce || !validGmailNonce(cookieNonce) || !cookieVerifier) return fail("not_started_here");

  const state = parseGmailOAuthState(params.get("state"));
  if (!state || state.nonce !== cookieNonce || !state.connectionId) return fail("invalid_state");
  const connectionId = state.connectionId;

  const code = params.get("code");
  if (!code) return fail(params.get("error") ?? "oauth_denied");

  // RLS scopes this to the caller's own tenant, same check as the connect route.
  const { data: connection } = await context.supabase
    .from("connector_connections")
    .select("id, connector_id, status")
    .eq("id", connectionId)
    .eq("connector_id", GMAIL_CONNECTOR_ID)
    .maybeSingle();
  if (!connection || connection.status === "disconnected") return fail("connection_not_found");

  let accessToken: string;
  try {
    const exchanged = await exchangeGmailOAuthCode({
      code,
      redirectUri: `${origin(request)}/api/connectors/gmail/callback`,
      verifier: cookieVerifier,
    });
    accessToken = exchanged.accessToken;
    const result = await setConnectorSecret({
      tenantId: identity.tenant.tenantId,
      userId: identity.userId,
      connectionId,
      secretType: "oauth_refresh_token",
      plaintextSecret: exchanged.refreshToken,
    });
    if (result !== "ok") return fail(result);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "oauth_exchange_failed");
  }

  // Best-effort only, outside the try/catch above: the connection already
  // succeeded, and a failure resolving or storing the label must never be
  // reported as a failed connect.
  try {
    const email = await fetchGmailAccountEmail(accessToken);
    if (email) {
      await updateConnectorConnectionConfig({
        tenantId: identity.tenant.tenantId,
        userId: identity.userId,
        connectionId,
        config: { connectedEmail: email },
      });
    }
  } catch {
    // Non-fatal -- see comment above.
  }

  return finish(`${PAGE}?connected=1`);
}
