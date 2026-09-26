import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { UNAUTHENTICATED, contractForError, extractBearer, jsonError, jsonOk, logHandlerFailure, newRequestId } from "@/lib/gateway/http";
import { failureContract } from "@/lib/gateway/response";
import { approvalById } from "@/lib/gateway/rpc-github";

/**
 * `GET /api/v1/approvals/{id}` — the agent polls a runtime approval it is
 * waiting on. It reveals state only (pending/approved/rejected/expired/stale/
 * consumed) — never approver identities, notes or evidence. Once `approved`,
 * the agent re-calls POST /api/v1/authorize with the SAME idempotency key and
 * arguments; the capability is minted there after every input is re-checked.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const requestId = newRequestId();
  const credentialSecret = extractBearer(request);
  if (!credentialSecret) return jsonError(UNAUTHENTICATED, requestId);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return jsonError({ http: 400, code: "INVALID_REQUEST", message: "Request failed validation." }, requestId);
  }
  try {
    const r = await approvalById({ credentialSecret, approvalId: id });
    if (r.status !== "ok") return jsonError(failureContract(r.status), requestId);
    if (r.state === "not_found" || !r.approvalId) {
      return jsonError({ http: 404, code: "APPROVAL_NOT_FOUND", message: "No such approval." }, requestId);
    }
    return jsonOk(
      { approvalId: r.approvalId, state: r.state, requiredApprovals: r.required, approvals: r.approved, expiresAt: r.expiresAt, reason: r.reason },
      requestId,
    );
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503) logHandlerFailure("approval-status", error);
    return jsonError(contract, requestId);
  }
}
