import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { runMaintenance } from "@/lib/maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Trigger for an external scheduler (Render cron job, GitHub Actions). Authenticated by a bearer token from
 * MAINTENANCE_TOKEN; without one configured the endpoint does not exist. The in-process scheduler already runs the same
 * work, so this is a redundancy for deployments that scale to zero or restart often.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.MAINTENANCE_TOKEN?.trim();
  if (!expected || expected.length < 24) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const auth = request.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!tokenMatches(presented, expected))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const report = await runMaintenance();
  return NextResponse.json(report, {
    status: report.errors.length > 0 ? 207 : 200,
    headers: { "cache-control": "no-store" },
  });
}
