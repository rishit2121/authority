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
import { listCustomerGithubRepositoriesForBackend } from "@/lib/gateway/rpc-github-delegation";

/**
 * `GET /api/v1/customers/{customerId}/github-repositories` — every GitHub
 * repository this customer has been explicitly delegated (Settings ->
 * Applications -> an admin action, never implicit from the tenant-wide
 * installation allowlist alone). The discovery step before
 * `POST /api/v1/tasks/{taskId}/github-repository`.
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
    const result = await listCustomerGithubRepositoriesForBackend(credentialSecret, customerId);
    if (result.status !== "ok") {
      return jsonError(developerApiFailureContract(result.status), requestId);
    }
    return jsonOk({ repositories: result.repositories }, requestId);
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503)
      logHandlerFailure("customers/github-repositories", error);
    return jsonError(contract, requestId);
  }
}
