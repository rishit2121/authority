import { NextResponse, type NextRequest } from "next/server";

import { requireIdentity } from "@/lib/auth/identity";
import { handleSetupCallback, PKCE_COOKIE, STATE_COOKIE } from "@/lib/github/installation";

/**
 * GitHub App "Setup URL". The `installation_id` query parameter is attacker-
 * controllable (anyone can craft this URL), so it is treated as a CLAIM: it is
 * bound to the signed-in user's HttpOnly state cookie and then verified
 * through GitHub's OAuth flow before any tenant mapping is written.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = "/app/integrations/github";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const identity = await requireIdentity(`${PAGE}`);
  const params = request.nextUrl.searchParams;
  const outcome = await handleSetupCallback({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    cookieNonce: request.cookies.get(STATE_COOKIE)?.value,
    cookieVerifier: request.cookies.get(PKCE_COOKIE)?.value,
    urlState: params.get("state"),
    installationId: params.get("installation_id"),
  });
  if (outcome.kind === "error") {
    return NextResponse.redirect(
      new URL(`${PAGE}?error=${encodeURIComponent(outcome.code)}`, request.nextUrl.origin),
    );
  }
  return NextResponse.redirect(outcome.url);
}
