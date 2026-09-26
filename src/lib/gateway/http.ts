import "server-only";

import { safeLog } from "@/lib/semantic/scrub";

import { NextResponse, type NextRequest } from "next/server";

import { PayloadTooLargeError } from "./argument-audit";
import { GatewayDatabaseError, GatewayNotConfiguredError } from "./db";
import type { FailureContract } from "./response";

/** Shared plumbing for the versioned runtime endpoints. */

export const MAX_BODY_BYTES = 65_536;

export function newRequestId(): string {
  return crypto.randomUUID();
}

/** Capabilities and runtime keys must never be cached by anything between the agent and us. */
function baseHeaders(requestId: string): Record<string, string> {
  return { "cache-control": "no-store", "x-request-id": requestId };
}

export function jsonOk(body: unknown, requestId: string, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: baseHeaders(requestId) });
}

export function jsonError(
  contract: FailureContract,
  requestId: string,
  extra?: Record<string, unknown>,
): NextResponse {
  const headers = baseHeaders(requestId);
  if (contract.retryAfterSeconds) headers["retry-after"] = String(contract.retryAfterSeconds);
  return NextResponse.json(
    {
      error: {
        code: contract.code,
        reason: contract.code.toLowerCase(),
        message: contract.message,
        requestId,
      },
      ...extra,
    },
    { status: contract.http, headers },
  );
}

export function extractBearer(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export const UNAUTHENTICATED: FailureContract = {
  http: 401,
  code: "UNAUTHENTICATED",
  message: "The runtime key is missing, invalid or revoked.",
};

/** Reads a JSON body under a hard size cap; never echoes any of it back. */
export async function readJsonBody(
  request: NextRequest,
): Promise<{ ok: true; body: unknown } | { ok: false; contract: FailureContract }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return {
      ok: false,
      contract: { http: 413, code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." },
    };
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return {
      ok: false,
      contract: { http: 413, code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." },
    };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      contract: { http: 400, code: "INVALID_REQUEST", message: "Request body must be valid JSON." },
    };
  }
}

/** Maps anything thrown inside a runtime handler to a stable, non-leaking contract. */
export function contractForError(error: unknown): FailureContract {
  if (error instanceof PayloadTooLargeError) {
    return { http: 413, code: "PAYLOAD_TOO_LARGE", message: "Request payload exceeds the allowed size." };
  }
  if (error instanceof GatewayNotConfiguredError) {
    return {
      http: 503,
      code: "GATEWAY_UNAVAILABLE",
      message: "The authorization gateway is not available.",
      retryAfterSeconds: 5,
    };
  }
  if (error instanceof GatewayDatabaseError) {
    // 22P02 invalid text representation (e.g. a malformed uuid), 22023 invalid parameter value.
    if (error.sqlstate === "22P02" || error.sqlstate === "22023") {
      return { http: 400, code: "INVALID_REQUEST", message: "Request failed validation." };
    }
    return {
      http: 503,
      code: "GATEWAY_UNAVAILABLE",
      message: "The authorization gateway is not available.",
      retryAfterSeconds: 5,
    };
  }
  return { http: 500, code: "INTERNAL_ERROR", message: "An unexpected error occurred." };
}

export function logHandlerFailure(route: string, error: unknown): void {
  // Class name only: messages and causes can carry request content or secrets.
  safeLog(`${route}: unexpected failure (${error instanceof Error ? error.name : "unknown"})`);
}
