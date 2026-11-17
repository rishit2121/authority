import { NextResponse, type NextRequest } from "next/server";

import { publicBaseUrl } from "@/lib/github/config";
import { requireIdentity } from "@/lib/auth/identity";
import { handleOAuthCallback, PKCE_COOKIE, STATE_COOKIE } from "@/lib/github/installation";
import { RETURN_TO_COOKIE, safeReturnTo, sameOriginUrl, withQueryParam } from "@/lib/setup/return-to";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = "/app/integrations/github";

/** Redirects stay on the configured public origin; `nextUrl.origin` can be the bind host (e.g. localhost). */
const origin = (request: NextRequest) => publicBaseUrl() ?? request.nextUrl.origin;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const identity = await requireIdentity(PAGE);
  const params = request.nextUrl.searchParams;
  const result = await handleOAuthCallback({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    cookieNonce: request.cookies.get(STATE_COOKIE)?.value,
    cookieVerifier: request.cookies.get(PKCE_COOKIE)?.value,
    state: params.get("state"),
    code: params.get("code"),
  });
  // Back to Setup when the install started there (cookie set by the connect route, re-validated here).
  const returnTo = safeReturnTo(request.cookies.get(RETURN_TO_COOKIE)?.value);
  const target = returnTo
    ? result.ok
      ? withQueryParam(returnTo, "connected", "github")
      : withQueryParam(returnTo, "connect_error", result.code)
    : result.ok
      ? `${PAGE}?connected=1`
      : `${PAGE}?error=${encodeURIComponent(result.code)}`;
  const response = NextResponse.redirect(sameOriginUrl(target, origin(request), PAGE));
  // The single-use nonce, PKCE verifier and return path are consumed either way.
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/github" });
  response.cookies.delete({ name: PKCE_COOKIE, path: "/api/github" });
  response.cookies.delete({ name: RETURN_TO_COOKIE, path: "/api/github" });
  return response;
}
