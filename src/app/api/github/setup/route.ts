import { NextResponse, type NextRequest } from "next/server";

import { publicBaseUrl } from "@/lib/github/config";
import { requireIdentity } from "@/lib/auth/identity";
import { liveInstallation } from "@/lib/gateway/rpc-github";
import {
  handleSetupCallback,
  PKCE_COOKIE,
  refreshInstallation,
  STATE_COOKIE,
} from "@/lib/github/installation";

/**
 * GitHub App "Setup URL". The `installation_id` query parameter is attacker-
 * controllable (anyone can craft this URL), so it is treated as a CLAIM: it is
 * bound to the signed-in user's HttpOnly state cookie and then verified
 * through GitHub's OAuth flow before any tenant mapping is written.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = "/app/integrations/github";

/** Redirects stay on the configured public origin; `nextUrl.origin` can be the bind host (e.g. localhost). */
const origin = (request: NextRequest) => publicBaseUrl() ?? request.nextUrl.origin;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const identity = await requireIdentity(`${PAGE}`);
  const params = request.nextUrl.searchParams;

  // "Redirect on update": GitHub sends the user back here after they add or remove repositories on an
  // installation that is ALREADY connected. There is no state cookie for that, and none is needed: nothing
  // is being mapped, only refreshed from GitHub for the installation this workspace already owns.
  const claimed = params.get("installation_id");
  if (!request.cookies.get(STATE_COOKIE)?.value && claimed && /^[0-9]{1,15}$/.test(claimed)) {
    const live = await liveInstallation({ tenantId: identity.tenant.tenantId, userId: identity.userId });
    if (live && live.githubInstallationId === claimed) {
      await refreshInstallation({
        tenantId: identity.tenant.tenantId,
        userId: identity.userId,
        installationRowId: live.rowId,
        githubInstallationId: live.githubInstallationId,
      }).catch(() => undefined);
      return NextResponse.redirect(new URL(`${PAGE}?updated=1`, origin(request)));
    }
  }
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
      new URL(`${PAGE}?error=${encodeURIComponent(outcome.code)}`, origin(request)),
    );
  }
  return NextResponse.redirect(outcome.url);
}
