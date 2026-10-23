import "server-only";

import { taskCredentialPolicy, tenantForTask } from "./rpc";
import { resolveCredential, taskSessionInfo } from "./rpc-sessions";
import type { GatewayStatus } from "./rpc";
import { TASK_SESSION_PREFIX } from "./task-session-token";

export type TaskReadAccess =
  { ok: true; tenantId: string } | { ok: false; status: Exclude<GatewayStatus, "ok"> | "task_not_found" };

/**
 * Whether a bearer credential may read a task's tool catalog. One rule for every discovery path (REST
 * `GET /tasks/{id}/tools` and MCP `tools/list`), so they cannot drift:
 *   - the credential must resolve (a revoked or unknown key is refused);
 *   - a task session is valid only for its own task;
 *   - an application that requires sessions refuses a raw runtime key;
 *   - the credential's tenant must own the task (never trust the task id in the URL alone).
 * A task owned by another tenant is reported exactly like a missing one.
 */
export async function checkTaskReadAccess(token: string, taskId: string): Promise<TaskReadAccess> {
  const resolved = await resolveCredential(token);
  if (resolved.status !== "ok") return { ok: false, status: resolved.status };

  if (token.startsWith(TASK_SESSION_PREFIX)) {
    const session = await taskSessionInfo(token);
    if (session.status !== "ok" || session.taskId !== taskId)
      return { ok: false, status: "session_task_mismatch" };
  }

  if (
    token.startsWith("authority_rk_") &&
    (await taskCredentialPolicy(token, taskId)) === "session_required"
  ) {
    return { ok: false, status: "session_required" };
  }

  const owningTenantId = await tenantForTask(taskId);
  if (!owningTenantId || owningTenantId !== resolved.tenantId) return { ok: false, status: "task_not_found" };
  return { ok: true, tenantId: owningTenantId };
}
