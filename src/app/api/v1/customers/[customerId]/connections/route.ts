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
import { listCustomerConnections } from "@/lib/gateway/rpc-customers";

/**
 * `GET /api/v1/customers/{customerId}/connections` — every connection this
 * customer may use right now: connections they own directly, plus any
 * organization-owned connection currently delegated to them. Never another
 * customer's connections, even within the same application.
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
  context: { params: Promise<{ customerId: string }> },
): Promise<NextResponse> {
  const requestId = newRequestId();
  const { customerId } = await context.params;
  const credentialSecret = extractBearer(request);
  if (!credentialSecret) return jsonError(UNAUTHENTICATED_BACKEND, requestId);

  try {
    const result = await listCustomerConnections({ credentialSecret, customerId });
    if (result.status !== "ok") {
      return jsonError(developerApiFailureContract(result.status), requestId);
    }
    return jsonOk({ connections: result.connections }, requestId);
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503) logHandlerFailure("customers/connections", error);
    return jsonError(contract, requestId);
  }
}
