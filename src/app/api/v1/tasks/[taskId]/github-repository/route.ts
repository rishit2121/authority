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
import { bindTaskGithubRepositoryForBackend } from "@/lib/gateway/rpc-github-delegation";

/**
 * `POST /api/v1/tasks/{taskId}/github-repository` — binds a task to a
 * repository explicitly delegated to that task's own customer
 * (`GET .../github-repositories` lists the eligible ones). A separate,
 * explicit step from task creation, matching how a human developer already
 * binds a repository on the dashboard as its own action -- not part of
 * `POST /api/v1/customers/{customerId}/tasks`, which has no concept of a
 * GitHub repository at all. Required once before any `github.*` tool in
 * this task's plan can compile or execute; this does not itself grant any
 * tool authority -- that is still decided by `tasks.prepare`'s own
 * validate -> solve -> compile pipeline exactly as for any other connector.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ repositoryId: z.string().uuid() }).strict();

const UNAUTHENTICATED_BACKEND = {
  http: 401,
  code: "UNAUTHENTICATED",
  message: "The backend credential is missing, invalid or revoked.",
};

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
    const status = await bindTaskGithubRepositoryForBackend({
      credentialSecret,
      taskId,
      repositoryId: parsed.data.repositoryId,
    });
    if (status !== "ok") {
      return jsonError(developerApiFailureContract(status), requestId);
    }
    return jsonOk({ taskId, repositoryId: parsed.data.repositoryId }, requestId);
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503) logHandlerFailure("tasks/github-repository", error);
    return jsonError(contract, requestId);
  }
}
