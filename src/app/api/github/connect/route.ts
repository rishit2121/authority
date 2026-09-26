import { NextResponse, type NextRequest } from "next/server";

import { requireIdentity } from "@/lib/auth/identity";
import { publicBaseUrl } from "@/lib/github/config";
import { COOKIE_MAX_AGE_SECONDS, PKCE_COOKIE, startInstall, STATE_COOKIE } from "@/lib/github/installation";

/**
 * Starts the GitHub App installation. A plain form POST (not a server action) because the
 * response must redirect the browser to another origin while setting the single-use state and
 * PKCE cookies. Same-origin only: a cross-site form cannot start an installation for a user.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = "/app/integrations/github";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const base = publicBaseUrl() ?? request.nextUrl.origin;
  const fail = (code: string) =>
    NextResponse.redirect(new URL(`${PAGE}?error=${encodeURIComponent(code)}`, base), 303);

  const sent = request.headers.get("origin");
  if (sent && sent !== base) return fail("forbidden");

  const identity = await requireIdentity(PAGE);
  const result = await startInstall({ tenantId: identity.tenant.tenantId, userId: identity.userId });
  if (result.status !== "ok" || !result.started) return fail(result.status);

  const response = NextResponse.redirect(result.started.installUrl, 303);
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && base.startsWith("https://"),
    path: "/api/github",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
  response.cookies.set(STATE_COOKIE, result.started.nonce, options);
  response.cookies.set(PKCE_COOKIE, result.started.verifier, options);
  return response;
}
