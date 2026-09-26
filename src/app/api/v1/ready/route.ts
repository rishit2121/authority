import { NextResponse } from "next/server";

import { gatewayPing } from "@/lib/gateway/rpc";
import { gatewayTlsRequired, gatewayTlsVerified, isGatewayConfigured } from "@/lib/gateway/db";
import { githubReadiness } from "@/lib/github/config";

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
  // A production deployment must verify the database certificate chain.
  if (gatewayTlsRequired() && !gatewayTlsVerified()) {
    return NextResponse.json({ status: "not_ready", gateway: "tls_unverified" }, { status: 503, headers });
  }
  try {
    const ok = await gatewayPing();
    // The GitHub connector is optional: its state is reported, and only a HALF-configured live
    // connector (live mode with missing settings) makes the deployment not ready.
    const gh = githubReadiness();
    const github = gh.mode === "disabled" ? "disabled" : gh.ready ? gh.mode : "misconfigured";
    if (ok && github === "misconfigured") {
      return NextResponse.json({ status: "not_ready", gateway: "ok", github }, { status: 503, headers });
    }
    const tls = gatewayTlsVerified() ? "verified" : "unverified_local";
    return NextResponse.json(ok ? { status: "ready", github, tls } : { status: "not_ready", gateway: "unreachable" }, {
      status: ok ? 200 : 503,
      headers,
    });
  } catch {
    return NextResponse.json({ status: "not_ready", gateway: "unreachable" }, { status: 503, headers });
  }
}
