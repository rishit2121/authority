import { NextResponse, type NextRequest } from "next/server";

import { slackFixtureModeEnabled } from "@/lib/connectors/slack/fixture-mode";
import { slackFixtureServer } from "@/lib/connectors/slack/fixture-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Test-only introspection for the in-process Slack fixture server -- exists
 * at all only when `slackFixtureModeEnabled()` is true, mirroring
 * /api/internal/stripe-fixture and /api/internal/custom-api-fixture exactly.
 */
export async function GET(): Promise<NextResponse> {
  if (!slackFixtureModeEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const server = slackFixtureServer();
  return NextResponse.json(
    { requestLog: server.requestLog, channels: server.channels, messages: server.messages },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!slackFixtureModeEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "reset") {
    return NextResponse.json({ error: "unsupported_action" }, { status: 400 });
  }
  slackFixtureServer().reset();
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
