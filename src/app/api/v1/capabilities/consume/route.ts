import type { NextResponse } from "next/server";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { toolArgumentsSchema, toolNameSchema } from "@/lib/domain";
import { sanitizeResource } from "@/lib/gateway/argument-audit";
import { hashCapabilityToken, isWellFormedCapabilityToken } from "@/lib/gateway/capability-token";
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
import { consumeCapability } from "@/lib/gateway/rpc";
import { failureContract } from "@/lib/gateway/response";

/**
 * `POST /api/v1/capabilities/consume` — SIMULATED consumption.
 *
 * Validates everything a real executor would (token, agent, tenant, expiry,
 * remaining uses, contract/task/agent/key still valid, exact tool, operation,
 * resource and arguments) and then calls nothing external. Part 7 replaces the
 * simulated step with a real connector behind this same validation.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    capability: z.string().min(1).max(200),
    tool: toolNameSchema,
    operation: z.string().trim().min(1).max(100),
    resource: z.string().trim().min(1).max(200).optional(),
    arguments: toolArgumentsSchema.default({}),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

const REJECTION_HTTP: Record<string, number> = {
  CAPABILITY_NOT_FOUND: 404,
  SCOPE_MISMATCH: 403,
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = newRequestId();
  const credentialSecret = extractBearer(request);
  if (!credentialSecret) return jsonError(UNAUTHENTICATED, requestId);

  const body = await readJsonBody(request);
  if (!body.ok) return jsonError(body.contract, requestId);

  const parsed = requestSchema.safeParse(body.body);
  if (!parsed.success || !isWellFormedCapabilityToken(parsed.data.capability)) {
    return jsonError(
      { http: 400, code: "INVALID_REQUEST", message: "Request failed validation." },
      requestId,
    );
  }
  const input = parsed.data;

  try {
    const result = await consumeCapability({
      credentialSecret,
      tokenHash: hashCapabilityToken(input.capability),
      tool: input.tool,
      operation: input.operation,
      resource: sanitizeResource(input.resource),
      args: input.arguments,
      idempotencyKey: input.idempotencyKey,
    });

    if (result.status !== "ok") return jsonError(failureContract(result.status), requestId);

    if (result.result === "accepted") {
      return jsonOk(
        {
          result: "accepted",
          capabilityId: result.capabilityId,
          remainingUses: result.remainingUses,
          expiresAt: result.expiresAt,
          replayed: result.replayed,
          simulated: true,
          message: "SIMULATED — no external tool was executed.",
        },
        requestId,
      );
    }

    const code = result.reasonCode ?? "CAPABILITY_REJECTED";
    return jsonError(
      { http: REJECTION_HTTP[code] ?? 409, code, message: "The capability could not be consumed." },
      requestId,
      {
        capability: result.capabilityId
          ? { id: result.capabilityId, remainingUses: result.remainingUses, expiresAt: result.expiresAt }
          : null,
        simulated: true,
      },
    );
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503) logHandlerFailure("consume", error);
    return jsonError(contract, requestId);
  }
}
