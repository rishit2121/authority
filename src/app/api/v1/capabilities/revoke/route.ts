import type { NextResponse } from "next/server";
import { type NextRequest } from "next/server";
import { z } from "zod";

import {
  UNAUTHENTICATED,
  contractForError,
  extractBearer,
  jsonError,
  jsonOk,
  logHandlerFailure,
  newRequestId,
  readJsonBody,
} from "@/lib/gateway/http";
import { failureContract } from "@/lib/gateway/response";
import { revokeCapabilityViaGateway } from "@/lib/gateway/rpc";

/** `POST /api/v1/capabilities/revoke` — an agent revokes one of its own capabilities. Idempotent. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({ capabilityId: z.string().uuid(), reason: z.string().trim().min(1).max(500) })
  .strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = newRequestId();
  const credentialSecret = extractBearer(request);
  if (!credentialSecret) return jsonError(UNAUTHENTICATED, requestId);

  const body = await readJsonBody(request);
  if (!body.ok) return jsonError(body.contract, requestId);
  const parsed = requestSchema.safeParse(body.body);
  if (!parsed.success) {
    return jsonError(
      { http: 400, code: "INVALID_REQUEST", message: "Request failed validation." },
      requestId,
    );
  }

  try {
    const result = await revokeCapabilityViaGateway({
      credentialSecret,
      capabilityId: parsed.data.capabilityId,
      reason: parsed.data.reason,
    });
    if (result.status !== "ok") return jsonError(failureContract(result.status), requestId);
    switch (result.result) {
      case "revoked":
      case "already_revoked":
        return jsonOk({ result: result.result, capabilityId: parsed.data.capabilityId }, requestId);
      case "not_revocable":
        return jsonError(
          {
            http: 409,
            code: "CAPABILITY_ALREADY_USED",
            message: "A fully used capability cannot be revoked.",
          },
          requestId,
        );
      default:
        return jsonError(
          { http: 404, code: "CAPABILITY_NOT_FOUND", message: "Capability not found." },
          requestId,
        );
    }
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503) logHandlerFailure("revoke", error);
    return jsonError(contract, requestId);
  }
}
