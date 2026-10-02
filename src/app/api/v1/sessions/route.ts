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
import { createTaskSession } from "@/lib/gateway/rpc-sessions";
import { generateTaskSessionToken } from "@/lib/gateway/task-session-token";

/**
 * `POST /api/v1/sessions` — an agent exchanges its runtime key for a
 * short-lived task session, once per task, instead of presenting the
 * runtime key on every subsequent authorize/execute call. Requires the
 * task to already have an active contract; a session is a convenience over
 * an authorized task, never a way to get ahead of contract activation.
 *
 * The returned token works anywhere a runtime key already does
 * (Authorization: Bearer ...) for THIS task only — see
 * gateway.resolve_bearer, which both credential types resolve through.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    taskId: z.string().uuid(),
    ttlSeconds: z.number().int().min(60).max(900).optional(),
  })
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
    const { plaintext, hash } = generateTaskSessionToken();
    const result = await createTaskSession({
      credentialSecret,
      taskId: parsed.data.taskId,
      tokenHash: hash,
      ttlSeconds: parsed.data.ttlSeconds ?? 900,
    });
    if (result.status !== "ok") return jsonError(failureContract(result.status), requestId);
    if (!result.sessionId || !result.contractId || result.contractVersion === null || !result.expiresAt) {
      return jsonError(
        { http: 500, code: "INTERNAL_ERROR", message: "Session was created but could not be read back." },
        requestId,
      );
    }
    return jsonOk(
      {
        sessionId: result.sessionId,
        token: plaintext,
        taskId: parsed.data.taskId,
        contract: { id: result.contractId, version: result.contractVersion },
        expiresAt: result.expiresAt,
      },
      requestId,
    );
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503) logHandlerFailure("sessions", error);
    return jsonError(contract, requestId);
  }
}
