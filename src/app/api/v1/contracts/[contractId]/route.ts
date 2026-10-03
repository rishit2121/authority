import type { NextResponse } from "next/server";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { extractBearer, jsonError, jsonOk, newRequestId } from "@/lib/gateway/http";
import { developerApiFailureContract } from "@/lib/gateway/response";
import { getContractForBackend } from "@/lib/gateway/rpc-tasks-lifecycle";

/**
 * `GET /api/v1/contracts/{contractId}` — the backend-credential read side
 * of `tasks.prepare`: for a contract left `awaiting_approval`, poll this
 * until `contractStatus` becomes `"active"` (a human approved and activated
 * it on the dashboard, at `/app/tasks/{taskId}`) or `"rejected"`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ contractId: string }> },
): Promise<NextResponse> {
  const requestId = newRequestId();
  const { contractId } = await context.params;
  if (!z.string().uuid().safeParse(contractId).success) {
    return jsonError(
      { http: 400, code: "INVALID_REQUEST", message: "contractId must be a UUID." },
      requestId,
    );
  }

  const credentialSecret = extractBearer(request);
  if (!credentialSecret) {
    return jsonError(
      {
        http: 401,
        code: "UNAUTHENTICATED",
        message: "The backend credential is missing, invalid or revoked.",
      },
      requestId,
    );
  }

  const result = await getContractForBackend(credentialSecret, contractId);
  if (result.status !== "ok") {
    return jsonError(developerApiFailureContract(result.status), requestId);
  }

  return jsonOk(
    {
      contractId,
      taskId: result.taskId,
      status: result.contractStatus,
      tools: result.tools,
      requiredApprovalsCount: result.requiredApprovalsCount,
    },
    requestId,
  );
}
