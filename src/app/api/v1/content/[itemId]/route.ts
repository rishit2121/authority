import type { NextResponse } from "next/server";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { getExternalContent } from "@/lib/gateway/rpc-alignment";
import {
  contractForError,
  extractBearer,
  jsonError,
  jsonOk,
  logHandlerFailure,
  newRequestId,
} from "@/lib/gateway/http";
import { developerApiFailureContract } from "@/lib/gateway/response";

/**
 * `GET /api/v1/content/{inspectionId}` -- the current state of an inspection.
 * Held or quarantined content is returned (as external data) only after an
 * administrator approved it on the dashboard; never because the content, or
 * an agent, says it was approved.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> },
): Promise<NextResponse> {
  const requestId = newRequestId();
  const { itemId } = await context.params;
  if (!z.string().uuid().safeParse(itemId).success) {
    return jsonError(
      { http: 400, code: "INVALID_REQUEST", message: "inspectionId must be a UUID." },
      requestId,
    );
  }
  const credentialSecret = extractBearer(request);
  if (!credentialSecret) return jsonError(developerApiFailureContract("malformed"), requestId);
  try {
    const item = await getExternalContent(credentialSecret, itemId);
    if (item.status !== "ok") return jsonError(developerApiFailureContract("not_found"), requestId);
    return jsonOk(
      {
        inspectionId: itemId,
        taskId: item.taskId,
        status: item.itemStatus,
        decision: item.decision,
        contentHash: item.contentHash,
        contextRevision: item.contextRevision,
        findings: item.findings,
        data: item.content !== null ? { role: "external_data", text: item.content } : null,
      },
      requestId,
    );
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503)
      logHandlerFailure("GET /api/v1/content/[itemId]", error);
    return jsonError(contract, requestId);
  }
}
