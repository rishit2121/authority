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
import { executeGithubOperation } from "@/lib/github/executor";
import { screenExecutionResult } from "@/lib/alignment/screen-execution";

/**
 * `POST /api/v1/github/execute` — the real GitHub connector.
 *
 * The agent presents a capability plus the exact arguments it was authorized
 * for. It never supplies a URL, HTTP method or API path; each tool maps to
 * fixed GitHub calls built server-side. See docs/github/CONNECTOR.md.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    capability: z.string().min(1).max(200),
    tool: toolNameSchema,
    operation: z.string().trim().min(1).max(100),
    resource: z.string().trim().min(1).max(200),
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
    const result = await executeGithubOperation({
      credentialSecret,
      tokenHash: hashCapabilityToken(input.capability),
      tool: input.tool,
      operation: input.operation,
      resource: sanitizeResource(input.resource),
      args: input.arguments,
      idempotencyKey: input.idempotencyKey,
    });
    if (result.http >= 200 && result.http < 300) {
      // Task alignment: screen what the provider returned before the agent sees it (no-op unless enabled).
      const screened = await screenExecutionResult({
        credentialSecret,
        taskId: result.taskId,
        tool: input.tool,
        args: input.arguments,
        http: result.http,
        body: result.body,
      });
      return jsonOk({ ...screened, requestId }, requestId, result.http);
    }
    return NextResponse.json(
      { ...result.body, requestId },
      { status: result.http, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503) logHandlerFailure("github-execute", error);
    return jsonError(contract, requestId);
  }
}
