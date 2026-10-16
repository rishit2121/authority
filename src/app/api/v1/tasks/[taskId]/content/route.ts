import type { NextResponse } from "next/server";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { inspectExternalContentForTask } from "@/lib/alignment/service";
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

/**
 * `POST /api/v1/tasks/{taskId}/content` -- inspect external content (a web
 * page, email, Slack message, document, database/API text, retrieved memory)
 * BEFORE the application gives it to its model.
 *
 * Authenticated by the application's backend key or by a task session for
 * this task (a raw runtime key is refused while enforcement is on). Source
 * fields are descriptive only; nothing a caller sends can mark content as a
 * trusted instruction -- unknown fields are rejected. Content that may go to
 * the model comes back in `data` as `external_data`, never as a user or
 * system message, and passing inspection is not a guarantee it is safe.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Applications can inspect up to 128 KiB; the envelope allows for JSON escaping. */
const MAX_REQUEST_BYTES = 300_000;

const requestSchema = z
  .object({
    content: z.string().max(140_000),
    contentType: z.string().min(1).max(100).default("text/plain"),
    source: z
      .object({
        kind: z.enum([
          "web",
          "document",
          "email",
          "slack",
          "database",
          "api",
          "memory",
          "tool_result",
          "other",
        ]),
        label: z.string().max(200).optional(),
        uri: z.string().max(500).optional(),
        toolName: z.string().max(100).optional(),
        toolArgs: z.string().max(2000).optional(),
      })
      .strict(),
  })
  .strict();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const requestId = newRequestId();
  const { taskId } = await context.params;
  if (!z.string().uuid().safeParse(taskId).success) {
    return jsonError({ http: 400, code: "INVALID_REQUEST", message: "taskId must be a UUID." }, requestId);
  }
  const credentialSecret = extractBearer(request);
  if (!credentialSecret) return jsonError(developerApiFailureContract("malformed"), requestId);

  const body = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!body.ok) return jsonError(body.contract, requestId);
  const parsed = requestSchema.safeParse(body.body);
  if (!parsed.success) {
    return jsonError(
      { http: 400, code: "INVALID_REQUEST", message: "Request failed validation." },
      requestId,
    );
  }

  try {
    const result = await inspectExternalContentForTask({
      secret: credentialSecret,
      taskId,
      content: parsed.data.content,
      contentType: parsed.data.contentType,
      source: parsed.data.source,
      origin: "api",
    });
    if (!result.ok) return jsonError(developerApiFailureContract(result.status), requestId);
    return jsonOk(
      {
        taskId,
        inspectionId: result.inspectionId,
        status: result.status,
        mode: result.mode,
        policy: result.policy,
        contentHash: result.contentHash,
        contextRevision: result.contextRevision,
        findings: result.findings,
        feedback: result.feedback,
        data: result.delivered,
      },
      requestId,
    );
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503)
      logHandlerFailure("POST /api/v1/tasks/[taskId]/content", error);
    return jsonError(contract, requestId);
  }
}
