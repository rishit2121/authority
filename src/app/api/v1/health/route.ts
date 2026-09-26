import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness: the process is up. Touches no dependency and reveals nothing. */
export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
