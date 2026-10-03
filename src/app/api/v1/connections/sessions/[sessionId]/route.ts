import type { NextResponse } from "next/server";
import { type NextRequest } from "next/server";

import {
  contractForError,
  extractBearer,
  jsonError,
  jsonOk,
  logHandlerFailure,
  newRequestId,
} from "@/lib/gateway/http";
import { developerApiFailureContract } from "@/lib/gateway/response";
import { connectionSessionStatus } from "@/lib/gateway/rpc-connection-sessions";

/**
 * `GET /api/v1/connections/sessions/{sessionId}` — the application backend
 * polls this after redirecting Alex back, to find out whether the
 * connection actually completed and, if so, which connection id was
 * created. Authenticated by the backend credential, scoped to its own
 * application -- one application's backend can never read another
 * application's session status even within the same tenant.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAUTHENTICATED_BACKEND = {
  http: 401,
  code: "UNAUTHENTICATED",
  message: "The backend credential is missing, invalid or revoked.",
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  const requestId = newRequestId();
  const { sessionId } = await context.params;
  const credentialSecret = extractBearer(request);
  if (!credentialSecret) return jsonError(UNAUTHENTICATED_BACKEND, requestId);

  try {
    const result = await connectionSessionStatus({ credentialSecret, sessionId });
    if (result.status !== "ok") {
      return jsonError(developerApiFailureContract(result.status), requestId);
    }
    return jsonOk(
      {
        status: result.sessionStatus,
        connectorId: result.connectorId,
        connectionId: result.connectionId,
        expiresAt: result.expiresAt,
      },
      requestId,
    );
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503)
      logHandlerFailure("connections/sessions/status", error);
    return jsonError(contract, requestId);
  }
}
