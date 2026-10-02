import { NextResponse, type NextRequest } from "next/server";

import { stripeFixtureModeEnabled } from "@/lib/connectors/stripe/fixture-mode";
import { stripeFixtureServer } from "@/lib/connectors/stripe/fixture-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Test-only introspection for the in-process Stripe fixture server -- exists
 * at all only when `stripeFixtureModeEnabled()` is true, mirroring
 * /api/internal/custom-api-fixture exactly. Lets the e2e suite prove a
 * denied request never reached the fixture, rather than inferring it from
 * the authorize/execute response alone.
 */
export async function GET(): Promise<NextResponse> {
  if (!stripeFixtureModeEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const server = stripeFixtureServer();
  return NextResponse.json(
    {
      requestLog: server.requestLog,
      paymentIntents: Object.fromEntries(server.paymentIntents),
      customers: Object.fromEntries(server.customers),
      charges: Object.fromEntries(server.charges),
      refunds: server.refunds,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!stripeFixtureModeEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "reset") {
    return NextResponse.json({ error: "unsupported_action" }, { status: 400 });
  }
  stripeFixtureServer().reset();
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
