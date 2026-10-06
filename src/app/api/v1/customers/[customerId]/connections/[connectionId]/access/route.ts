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
import {
  grantConnectionAccessForBackend,
  revokeConnectionAccessForBackend,
} from "@/lib/gateway/rpc-access-management";
import { developerApiFailureContract } from "@/lib/gateway/response";

/**
 * `POST`/`DELETE /api/v1/customers/{customerId}/connections/{connectionId}/access`
 * — backend self-service grant/revoke, scoped to whatever an admin has
 * explicitly allow-listed for this application (Settings -> Applications
 * -> Access policy). Refused outright -- `FORBIDDEN` or `NOT_IN_ENVELOPE`
 * -- for any connection/credential combination the admin hasn't
 * authorized; this endpoint can never widen that envelope itself.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAUTHENTICATED_BACKEND = {
  http: 401,
  code: "UNAUTHENTICATED",
  message: "The backend credential is missing, invalid or revoked.",
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ customerId: string; connectionId: string }> },
): Promise<NextResponse> {
  const requestId = newRequestId();
  const { customerId, connectionId } = await context.params;
  const credentialSecret = extractBearer(request);
  if (!credentialSecret) return jsonError(UNAUTHENTICATED_BACKEND, requestId);

  try {
    const status = await grantConnectionAccessForBackend({ credentialSecret, connectionId, customerId });
    if (status !== "ok") return jsonError(developerApiFailureContract(status), requestId);
    return jsonOk({ connectionId, customerId, status: "granted" }, requestId);
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503)
      logHandlerFailure("customers/connections/access", error);
    return jsonError(contract, requestId);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ customerId: string; connectionId: string }> },
): Promise<NextResponse> {
  const requestId = newRequestId();
  const { customerId, connectionId } = await context.params;
  const credentialSecret = extractBearer(request);
  if (!credentialSecret) return jsonError(UNAUTHENTICATED_BACKEND, requestId);

  try {
    const status = await revokeConnectionAccessForBackend({ credentialSecret, connectionId, customerId });
    if (status !== "ok") return jsonError(developerApiFailureContract(status), requestId);
    return jsonOk({ connectionId, customerId, status: "revoked" }, requestId);
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503)
      logHandlerFailure("customers/connections/access", error);
    return jsonError(contract, requestId);
  }
}
