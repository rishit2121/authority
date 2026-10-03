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
import { prepareTask } from "@/lib/gateway/prepare-task";

/**
 * `POST /api/v1/tasks/{taskId}/prepare` — the one call an application
 * backend needs to go from "a task exists" to "an agent can run it": submit
 * a candidate plan (structured, or `generate: true` for an AI-drafted one),
 * and this runs the exact same validate -> solve -> compile -> verify
 * pipeline the dashboard's "propose contract" button runs, then attempts
 * automatic activation under the bounded conditions in
 * `gateway.activate_task_contract_for_backend`. See prepare-task.ts's
 * module doc for exactly what is and isn't run here relative to the
 * dashboard path.
 *
 * Always returns 200 with a discriminated `status` field on success --
 * "awaiting_approval" and "clarification" are expected, common outcomes,
 * not errors. A 4xx/5xx here means the request itself (credential, task
 * ownership, payload shape) was invalid, not that the proposed plan needs
 * work.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    plan: z.unknown().optional(),
    generate: z.boolean().optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine((v) => (v.generate ? v.plan === undefined : v.plan !== undefined), {
    message: "Exactly one of `plan` or `generate: true` must be provided.",
  });

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
  if (!credentialSecret) {
    return jsonError(
      {
        http: 401,
        code: "UNAUTHENTICATED",
        message: "The backend credential is missing, invalid or revoked.",
      },
      requestId,
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return jsonError(body.contract, requestId);
  const parsed = requestSchema.safeParse(body.body);
  if (!parsed.success) {
    return jsonError(
      {
        http: 400,
        code: "INVALID_REQUEST",
        message: parsed.error.issues[0]?.message ?? "Request failed validation.",
      },
      requestId,
    );
  }

  try {
    const result = await prepareTask({
      credentialSecret,
      taskId,
      plan: parsed.data.plan,
      generate: parsed.data.generate,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
    });
    if (!result.ok) {
      return jsonError(developerApiFailureContract(result.status), requestId);
    }
    return jsonOk({ taskId, ...result.outcome }, requestId);
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503) logHandlerFailure("tasks/prepare", error);
    return jsonError(contract, requestId);
  }
}
