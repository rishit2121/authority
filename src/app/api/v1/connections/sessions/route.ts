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
import { createConnectionSession } from "@/lib/gateway/rpc-connection-sessions";

/**
 * `POST /api/v1/connections/sessions` — opens a short-lived, single-use
 * session for Mode A ("Authority manages a new connection"). The response's
 * `url` is what the application backend redirects its end user to; Alex
 * never sees or needs an Authority credential at any point in this flow.
 *
 * `returnUrl` must exactly match one already registered on the application
 * (dashboard Settings) -- never a pattern, so this can never become an open
 * redirect regardless of what a caller supplies.
 *
 * This endpoint only opens the session. The actual provider consent/
 * exchange is driven by a connector-specific `/connect/{token}` browser
 * route and that connector's own callback, mirroring the existing
 * dashboard-operated OAuth flow for the same provider.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    customerId: z.string().uuid(),
    connectorId: z.string().min(1).max(64),
    returnUrl: z.string().url().max(2000),
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
    const result = await createConnectionSession({
      credentialSecret,
      customerId: parsed.data.customerId,
      connectorId: parsed.data.connectorId,
      returnUrl: parsed.data.returnUrl,
    });
    if (result.status !== "ok" || !result.sessionId || !result.token) {
      return jsonError(developerApiFailureContract(result.status), requestId);
    }
    return jsonOk(
      {
        sessionId: result.sessionId,
        // The browser-facing URL a connector-specific `/connect/[token]` page
        // resolves; never an Authority dashboard URL, and never requires one.
        url: `/connect/${result.token}`,
        expiresAt: result.expiresAt,
      },
      requestId,
      201,
    );
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503) logHandlerFailure("connections/sessions", error);
    return jsonError(contract, requestId);
  }
}
