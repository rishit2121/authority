import type { NextResponse } from "next/server";
import { type NextRequest } from "next/server";
import { z } from "zod";

import {
  MAX_BODY_BYTES,
  UNAUTHENTICATED,
  contractForError,
  extractBearer,
  jsonError,
  jsonOk,
  logHandlerFailure,
  newRequestId,
} from "@/lib/gateway/http";
import { revokeTaskSession } from "@/lib/gateway/rpc-sessions";
import { TASK_SESSION_PREFIX } from "@/lib/gateway/task-session-token";

/**
 * `POST /api/v1/sessions/revoke` — self-revocation, authenticated by the
 * session token itself (like a capability revoking itself), not the runtime
 * key that created it. An empty body is fine; `reason` is optional. Idempotent.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ reason: z.string().trim().min(1).max(500).optional() }).strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = newRequestId();
  const token = extractBearer(request);
  if (!token) return jsonError(UNAUTHENTICATED, requestId);
  if (!token.startsWith(TASK_SESSION_PREFIX)) {
    return jsonError(
      {
        http: 400,
        code: "NOT_A_SESSION_TOKEN",
        message: "This endpoint accepts a task-session token, not a runtime key.",
      },
      requestId,
    );
  }

  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return jsonError(
      { http: 413, code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." },
      requestId,
    );
  }
  let payload: unknown = {};
  if (text.trim().length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      return jsonError(
        { http: 400, code: "INVALID_REQUEST", message: "Request body must be valid JSON." },
        requestId,
      );
    }
  }
  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonError(
      { http: 400, code: "INVALID_REQUEST", message: "Request failed validation." },
      requestId,
    );
  }

  try {
    const result = await revokeTaskSession({ token, reason: parsed.data.reason });
    if (result === "invalid_token") {
      return jsonError(
        {
          http: 400,
          code: "NOT_A_SESSION_TOKEN",
          message: "This endpoint accepts a task-session token, not a runtime key.",
        },
        requestId,
      );
    }
    if (result === "not_found") {
      return jsonError({ http: 404, code: "SESSION_NOT_FOUND", message: "Session not found." }, requestId);
    }
    return jsonOk({ result }, requestId);
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503) logHandlerFailure("sessions/revoke", error);
    return jsonError(contract, requestId);
  }
}
