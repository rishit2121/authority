import { NextResponse } from "next/server";

import { gatewayPing } from "@/lib/gateway/rpc";
import { isGatewayConfigured } from "@/lib/gateway/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness: the gateway can actually reach its database with its dedicated
 * credential. Returns 503 otherwise so an orchestrator stops routing agents
 * here. The body names no host, role, version or error detail.
 */
export async function GET(): Promise<NextResponse> {
  const headers = { "cache-control": "no-store" };
  if (!isGatewayConfigured()) {
    return NextResponse.json({ status: "not_ready", gateway: "not_configured" }, { status: 503, headers });
  }
  try {
    const ok = await gatewayPing();
    return NextResponse.json(ok ? { status: "ready" } : { status: "not_ready", gateway: "unreachable" }, {
      status: ok ? 200 : 503,
      headers,
    });
  } catch {
    return NextResponse.json({ status: "not_ready", gateway: "unreachable" }, { status: 503, headers });
  }
}
