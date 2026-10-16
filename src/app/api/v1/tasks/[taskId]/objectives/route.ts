import type { NextResponse } from "next/server";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { reviseObjectives } from "@/lib/alignment/service";
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
 * `POST /api/v1/tasks/{taskId}/objectives` -- the user changed or clarified
 * what they want. Backend key only: agents, tool results and external
 * content can never revise a task's objectives. Creates a new objectives
 * version; reviews bound to the old version stop counting, so re-prepare.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ request: z.string().trim().min(1).max(8000) }).strict();

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
    const result = await reviseObjectives(credentialSecret, taskId, parsed.data.request);
    if (!result.ok) return jsonError(developerApiFailureContract(result.status), requestId);
    return jsonOk(
      {
        taskId,
        version: result.version,
        taskInstructions: result.objectives.taskInstructions,
        prohibitions: result.objectives.prohibitions,
        requirements: result.objectives.requirements,
      },
      requestId,
    );
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503)
      logHandlerFailure("POST /api/v1/tasks/[taskId]/objectives", error);
    return jsonError(contract, requestId);
  }
}
