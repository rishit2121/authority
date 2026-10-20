import { createHash } from "node:crypto";

import type { NextResponse } from "next/server";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { COMPILER_VERSION } from "@/lib/authorization/contract-compiler";
import { UNAUTHENTICATED, extractBearer, jsonError, jsonOk, newRequestId } from "@/lib/gateway/http";
import { activeContractForTask, autoExecuteToolsForTask, tenantForTask } from "@/lib/gateway/rpc";
import { failureContract } from "@/lib/gateway/response";
import { resolveCredential, taskSessionInfo } from "@/lib/gateway/rpc-sessions";
import { TASK_SESSION_PREFIX } from "@/lib/gateway/task-session-token";
import { buildMcpToolCatalog } from "@/lib/mcp/bridge";
import { buildTenantRegistry } from "@/lib/registry";
import type { ArgumentField } from "@/lib/registry/types";
import { taskCredentialPolicy } from "@/lib/gateway/rpc";

/**
 * `GET /api/v1/tasks/{taskId}/tools` — the contract-filtered tool manifest:
 * every distinct operation this task's currently active contract allows,
 * with enough detail (input schema, resource constraints, use limit,
 * approval requirement) for an agent to construct a correct authorize call
 * without guessing. Built from the same source buildMcpToolCatalog already
 * uses for MCP's tools/list (src/lib/mcp/bridge.ts) — this is a second
 * transport over identical discovery logic, not a second implementation of
 * it. No active contract is a typed 409, never a silent fallback to every
 * registered tool.
 *
 * A filtered manifest is convenience, not authority: listing a tool here
 * grants nothing by itself, and a handcrafted authorize call for a tool
 * NOT in this list (or a stale, previously-fetched manifest) is still
 * independently checked and denied by the real pipeline exactly as if this
 * endpoint didn't exist.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonSchemaFor(fields: readonly ArgumentField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of fields) {
    properties[field.key] = {
      type:
        field.type === "string"
          ? "string"
          : field.type === "number"
            ? "number"
            : field.type === "boolean"
              ? "boolean"
              : "array",
      ...(field.type === "stringArray" ? { items: { type: "string" } } : {}),
    };
    if (field.required) required.push(field.key);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const requestId = newRequestId();
  const token = extractBearer(request);
  if (!token) return jsonError(UNAUTHENTICATED, requestId);

  const { taskId } = await context.params;
  if (!z.string().uuid().safeParse(taskId).success) {
    return jsonError({ http: 400, code: "INVALID_REQUEST", message: "taskId must be a UUID." }, requestId);
  }

  const resolved = await resolveCredential(token);
  if (resolved.status !== "ok") return jsonError(failureContract(resolved.status), requestId);

  // A session is scoped to one task; a direct runtime key is not, so
  // cross-task use is only meaningful to check for a session.
  if (token.startsWith(TASK_SESSION_PREFIX)) {
    const session = await taskSessionInfo(token);
    if (session.status !== "ok" || session.taskId !== taskId) {
      return jsonError(failureContract("session_task_mismatch"), requestId);
    }
  }

  // An application that requires task sessions never lists a task's tools for a raw runtime key.
  if (
    token.startsWith("authority_rk_") &&
    (await taskCredentialPolicy(token, taskId)) === "session_required"
  ) {
    return jsonError(failureContract("session_required"), requestId);
  }

  // Either way, the credential's own tenant must actually own this task --
  // never trust the taskId in the URL alone.
  const owningTenantId = await tenantForTask(taskId);
  if (!owningTenantId || owningTenantId !== resolved.tenantId) {
    return jsonError({ http: 404, code: "TASK_NOT_FOUND", message: "Task not found." }, requestId);
  }

  const catalog = await buildMcpToolCatalog(taskId);
  if (catalog.status === "task_not_found") {
    return jsonError({ http: 404, code: "TASK_NOT_FOUND", message: "Task not found." }, requestId);
  }
  if (catalog.status === "no_active_contract") {
    return jsonError(failureContract("no_active_contract"), requestId);
  }

  const contract = await activeContractForTask(taskId);
  const [registry, autoExecute] = await Promise.all([
    buildTenantRegistry(resolved.tenantId!),
    autoExecuteToolsForTask(taskId),
  ]);

  // One entry per allowed action: a tool the plan uses with two different sets
  // of pinned arguments (e.g. two recipients) appears twice, each entry with its
  // own constraints and budget, so an agent can see every call it may make.
  const actionsByTool = new Map<string, NonNullable<typeof contract>["allowedActions"]>();
  for (const action of contract?.allowedActions ?? []) {
    actionsByTool.set(action.tool, [...(actionsByTool.get(action.tool) ?? []), action]);
  }
  const tools = catalog.tools
    .flatMap((t) =>
      (actionsByTool.get(t.operation.id) ?? [undefined]).map((action) => ({
        tool: t.operation.id,
        description: t.description,
        inputSchema: jsonSchemaFor(t.operation.argumentFields),
        resourceConstraints: action?.constraints ?? [],
        maxInvocations: action?.maxInvocations ?? null,
        // Reflects this application's explicit automatic-execution opt-in for published Custom API writes.
        requiresApproval: t.operation.requiresApproval && !autoExecute.has(t.operation.id),
      })),
    )
    .sort((a, b) => a.tool.localeCompare(b.tool));

  const manifestHash = createHash("sha256")
    .update(
      JSON.stringify({
        contractId: contract?.contractId ?? null,
        contractVersion: contract?.version ?? null,
        registryVersion: registry.registryVersion,
        tools: tools.map((t) => t.tool),
      }),
    )
    .digest("hex");

  return jsonOk(
    {
      taskId,
      contract: { id: contract?.contractId ?? null, version: contract?.version ?? null },
      versions: { registry: registry.registryVersion, compiler: COMPILER_VERSION },
      manifestHash,
      tools,
    },
    requestId,
  );
}
