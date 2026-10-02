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
import { createCustomerTask } from "@/lib/gateway/rpc-customers";

/**
 * `POST /api/v1/customers/{customerId}/tasks` — the application backend
 * creates a task on this customer's behalf with its connector bindings set
 * explicitly, atomically, before any contract compilation or activation can
 * see the task. Every connectionId must already belong to this exact
 * customer, or be an organization connection explicitly delegated to them
 * -- never merely "in the same tenant." A request naming a connection this
 * customer cannot use fails the whole call; no task is created half-bound.
 *
 * This only creates the task row and its bindings — compiling, proposing
 * and activating a contract, and starting the agent's task session, are the
 * existing dashboard/runtime workflows, unchanged by this endpoint.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    agentId: z.string().uuid(),
    intent: z.string().min(1).max(4000),
    connections: z
      .array(z.object({ connectorId: z.string().min(1).max(64), connectionId: z.string().uuid() }))
      .max(20)
      .optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
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
    const result = await createCustomerTask({
      credentialSecret,
      customerId,
      agentId: parsed.data.agentId,
      intent: parsed.data.intent,
      connectorBindings: parsed.data.connections ?? [],
      idempotencyKey: parsed.data.idempotencyKey ?? null,
    });
    if (result.status !== "ok" || !result.taskId) {
      return jsonError(developerApiFailureContract(result.status), requestId);
    }
    return jsonOk(
      { taskId: result.taskId, wasCreated: result.wasCreated },
      requestId,
      result.wasCreated ? 201 : 200,
    );
  } catch (error) {
    const contract = contractForError(error);
    if (contract.http >= 500 && contract.http !== 503) logHandlerFailure("customers/tasks", error);
    return jsonError(contract, requestId);
  }
}
