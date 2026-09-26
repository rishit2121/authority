import { NextResponse, type NextRequest } from "next/server";

import { requireIdentity } from "@/lib/auth/identity";
import { handleOAuthCallback, PKCE_COOKIE, STATE_COOKIE } from "@/lib/github/installation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = "/app/integrations/github";

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
  const target = result.ok ? `${PAGE}?connected=1` : `${PAGE}?error=${encodeURIComponent(result.code)}`;
  const response = NextResponse.redirect(new URL(target, request.nextUrl.origin));
  // The single-use nonce and PKCE verifier are consumed either way.
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/github" });
  response.cookies.delete({ name: PKCE_COOKIE, path: "/api/github" });
  return response;
}
