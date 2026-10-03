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
import { developerApiFailureContract } from "@/lib/gateway/response";
import { createOrResolveCustomer } from "@/lib/gateway/rpc-customers";

/**
 * `POST /api/v1/customers` — an application backend creates or resolves one
 * of its own end users by an opaque external id it has already verified
 * from its own login session. Idempotent: calling this again with the same
 * external id always resolves the same customer, never creates a second
 * one. Authenticated by a developer backend credential (`authority_dk_...`),
 * never an agent runtime key or a dashboard session -- see
 * gateway.resolve_backend_credential's own module comment for why these
 * credential spaces are kept structurally separate.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    externalId: z.string().min(1).max(200),
    displayLabel: z.string().max(200).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const UNAUTHENTICATED_BACKEND = {
  http: 401,
  code: "UNAUTHENTICATED",
  message: "The backend credential is missing, invalid or revoked.",
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = newRequestId();
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
    const result = await createOrResolveCustomer({
      credentialSecret,
      externalId: parsed.data.externalId,
      displayLabel: parsed.data.displayLabel ?? null,
      metadata: parsed.data.metadata,
    });
    if (result.status !== "ok" || !result.customerId) {
      return jsonError(developerApiFailureContract(result.status), requestId);
    }
    return jsonOk(
      { customerId: result.customerId, wasCreated: result.wasCreated },
      requestId,
      result.wasCreated ? 201 : 200,
    );
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503) logHandlerFailure("customers", error);
    return jsonError(contract, requestId);
  }
}
