import { NextResponse, type NextRequest } from "next/server";

import { customApiFixtureModeEnabled } from "@/lib/connectors/custom-api/fixture-mode";
import { customApiFixtureServer } from "@/lib/connectors/custom-api/fixture-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Test-only introspection for the in-process Custom API fixture server --
 * exists at all only when `customApiFixtureModeEnabled()` is true (mirrors
 * /api/internal/maintenance's own "without the token configured, this
 * endpoint does not exist" pattern). Lets the e2e suite prove a denied
 * request never reached the fixture, rather than inferring it from the
 * authorize/execute response alone.
 */
export async function GET(): Promise<NextResponse> {
  if (!customApiFixtureModeEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const server = customApiFixtureServer();
  return NextResponse.json(
    { requestLog: server.requestLog, orders: Object.fromEntries(server.orders) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!customApiFixtureModeEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "reset") {
    return NextResponse.json({ error: "unsupported_action" }, { status: 400 });
  }
  customApiFixtureServer().reset();
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
