import type { NextResponse } from "next/server";
import { type NextRequest } from "next/server";
import { z } from "zod";

import {
  contractForError,
  extractBearer,
  jsonError,
  jsonOk,
  logHandlerFailure,
  newRequestId,
  readJsonBody,
} from "@/lib/gateway/http";
import { registerBrokerConnection } from "@/lib/gateway/rpc-connection-brokers";
import { developerApiFailureContract } from "@/lib/gateway/response";

/**
 * `POST /api/v1/customers/{customerId}/connections/broker` — registers an
 * existing, already-authorized connection this customer's application
 * already manages, for Mode B ("reuse the application's existing
 * connection"). No token or secret is accepted here -- Authority asks the
 * registered broker for a short-lived one at execution time, every time.
 * `brokerId` must already exist (dashboard Settings → application →
 * connection brokers); `brokerConnectionRef` is whatever identifier the
 * broker's own endpoint uses to find the right account.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    connectorId: z.string().min(1).max(64),
    brokerId: z.string().uuid(),
    brokerConnectionRef: z.string().min(1).max(200),
    verifiedAccountRef: z.string().min(1).max(200),
  })
  .strict();

const UNAUTHENTICATED_BACKEND = {
  http: 401,
  code: "UNAUTHENTICATED",
  message: "The backend credential is missing, invalid or revoked.",
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ customerId: string }> },
): Promise<NextResponse> {
  const requestId = newRequestId();
  const { customerId } = await context.params;
  const credentialSecret = extractBearer(request);
  if (!credentialSecret) return jsonError(UNAUTHENTICATED_BACKEND, requestId);

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
    const result = await registerBrokerConnection({
      credentialSecret,
      customerId,
      connectorId: parsed.data.connectorId,
      brokerId: parsed.data.brokerId,
      brokerConnectionRef: parsed.data.brokerConnectionRef,
      verifiedAccountRef: parsed.data.verifiedAccountRef,
    });
    if (result.status !== "ok" || !result.connectionId) {
      return jsonError(developerApiFailureContract(result.status), requestId);
    }
    return jsonOk({ connectionId: result.connectionId }, requestId, 201);
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503)
      logHandlerFailure("customers/connections/broker", error);
    return jsonError(contract, requestId);
  }
}
