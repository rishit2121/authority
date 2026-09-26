import { NextResponse, type NextRequest } from "next/server";

import { safeLog } from "@/lib/semantic/scrub";
import { processWebhook } from "@/lib/github/installation";

/**
 * GitHub App webhook. Unauthenticated by session by design: authenticity is
 * the HMAC-SHA256 signature over the raw body (X-Hub-Signature-256), verified in
 * constant time BEFORE the payload is parsed. Deliveries are de-duplicated by
 * delivery id. Only `installation` and `installation_repositories` are acted on.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 1_048_576;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_BYTES)
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  try {
    const result = await processWebhook({
      rawBody,
      signature: request.headers.get("x-hub-signature-256"),
      event: request.headers.get("x-github-event"),
      deliveryId: request.headers.get("x-github-delivery"),
    });
    return NextResponse.json(result.body, { status: result.http, headers: { "cache-control": "no-store" } });
  } catch {
    safeLog("github webhook: processing failed");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
