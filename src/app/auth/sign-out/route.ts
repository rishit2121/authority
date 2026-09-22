import { NextResponse, type NextRequest } from "next/server";

import { TENANT_COOKIE_NAME } from "@/lib/auth/tenant-context";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign-out.
 *
 * POST only. A GET endpoint that destroys a session can be triggered by any
 * image or link on another site, which makes signing the user out a trivial
 * cross-site nuisance.
 */
export async function POST(_request: NextRequest) {
  const supabase = await createClient();

  // `scope: "local"` ends this browser's session only.
  //
  // Supabase defaults to "global", which revokes every refresh token the user
  // holds on every device. That is a surprising thing for a sign-out button to
  // do, and it belongs behind an explicit "sign out everywhere" control rather
  // than happening silently here.
  //
  // Best effort: if the provider call fails, the cookies are still cleared
  // below, so the browser stops presenting a session either way.
  await supabase.auth.signOut({ scope: "local" });

  // A relative Location, resolved by the browser against the origin it
  // actually requested. Building an absolute URL from `request.nextUrl.origin`
  // is wrong here: Next reports its configured hostname, so a request to
  // 127.0.0.1 would be redirected to localhost — a different origin, which
  // silently drops the session cookies being cleared.
  const response = new NextResponse(null, {
    // 303 so the browser follows with GET rather than repeating the POST.
    status: 303,
    headers: { Location: "/" },
  });

  // The workspace preference is meaningless once signed out, and leaving it
  // would carry one account's last workspace into the next sign-in on a
  // shared machine.
  response.cookies.delete(TENANT_COOKIE_NAME);

  return response;
}
