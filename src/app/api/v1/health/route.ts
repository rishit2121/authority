import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness: the process is up. Touches no dependency.
 *
 * `commit` is Render's own `RENDER_GIT_COMMIT` (a public git SHA, not a secret) when running there, so a deployment can
 * be verified against the commit that was supposed to ship; it is omitted anywhere that variable isn't set (local dev,
 * other hosts).
 */
export function GET(): NextResponse {
  const commit = process.env.RENDER_GIT_COMMIT?.trim().slice(0, 12) || undefined;
  return NextResponse.json(
    { status: "ok", ...(commit ? { commit } : {}) },
    { headers: { "cache-control": "no-store" } },
  );
}
