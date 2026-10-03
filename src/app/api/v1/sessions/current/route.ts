import type { NextResponse } from "next/server";
import { type NextRequest } from "next/server";

import { UNAUTHENTICATED, extractBearer, jsonError, jsonOk, newRequestId } from "@/lib/gateway/http";
import { taskSessionInfo } from "@/lib/gateway/rpc-sessions";
import { TASK_SESSION_PREFIX } from "@/lib/gateway/task-session-token";

/**
 * `GET /api/v1/sessions/current` — introspects the task-session token
 * presented as the bearer. Unlike authorize/execute, this endpoint gives a
 * typed reason a session is no longer usable (expired, revoked, or its
 * issuing credential/agent is no longer active) — it exists specifically
 * for that, so the anti-enumeration collapse everywhere else doesn't apply.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_CONTRACT: Record<string, { code: string; message: string }> = {
  not_found: { code: "SESSION_NOT_FOUND", message: "No session found for this token." },
  revoked: { code: "SESSION_REVOKED", message: "This session was revoked." },
  expired: { code: "SESSION_EXPIRED", message: "This session has expired." },
  credential_revoked: {
    code: "SESSION_CREDENTIAL_REVOKED",
    message: "The runtime key or agent that created this session is no longer active.",
  },
};

export async function GET(request: NextRequest): Promise<NextResponse> {
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

  const info = await taskSessionInfo(token);
  if (info.status !== "ok") {
    const mapped = STATUS_CONTRACT[info.status] ?? {
      code: "SESSION_NOT_FOUND",
      message: "Session not found.",
    };
    return jsonError({ http: 401, code: mapped.code, message: mapped.message }, requestId);
  }

  return jsonOk(
    {
      sessionId: info.sessionId,
      taskId: info.taskId,
      agentId: info.agentId,
      contract: { id: info.contractId, version: info.contractVersion },
      expiresAt: info.expiresAt,
    },
    requestId,
  );
}
