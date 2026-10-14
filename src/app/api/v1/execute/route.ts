import { NextResponse, type NextRequest } from "next/server";
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
import { executeConnectorOperation } from "@/lib/connectors";
import { deriveResource } from "@/lib/connectors/derive-resource";

/**
 * `POST /api/v1/execute` — the generic connector counterpart to
 * `/api/v1/github/execute`: dispatches by the authorized tool's provider
 * prefix to whichever `AuthorityConnector` owns it (Stripe, Gmail, Slack,
 * PostgreSQL, a tenant's Custom API connections — not GitHub, which keeps
 * its own dedicated route and executor unchanged).
 *
 * Same contract as the GitHub route: the agent presents a capability plus
 * the exact arguments it was authorized for, and never supplies a URL, HTTP
 * method, header, or credential. See docs/api/OPENAPI.yaml.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    capability: z.string().min(1).max(200),
    tool: toolNameSchema,
    operation: z.string().trim().min(1).max(100),
    /** Optional: when omitted, derived from `arguments` by the tool's own connector. */
    resource: z.string().trim().min(1).max(200).optional(),
    arguments: toolArgumentsSchema.default({}),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

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
    const resource = input.resource ?? (await deriveResource(input.tool, input.arguments));
    if (!resource) {
      return jsonError(
        {
          http: 400,
          code: "INVALID_REQUEST",
          message: "Could not determine the resource from these arguments; pass `resource` explicitly.",
        },
        requestId,
      );
    }
    const result = await executeConnectorOperation({
      credentialSecret,
      tokenHash: hashCapabilityToken(input.capability),
      tool: input.tool,
      operation: input.operation,
      resource: sanitizeResource(resource),
      args: input.arguments,
      idempotencyKey: input.idempotencyKey,
    });
    if (result.http >= 200 && result.http < 300)
      return jsonOk({ ...result.body, requestId }, requestId, result.http);
    return NextResponse.json(
      { ...result.body, requestId },
      { status: result.http, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503) logHandlerFailure("connector-execute", error);
    return jsonError(contract, requestId);
  }
}
