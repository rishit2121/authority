import "server-only";

import { gatewayQuery } from "./db";
import type { GatewayStatus } from "./rpc";

type Row = Record<string, unknown>;

export interface CreateTaskSessionResult {
  status: GatewayStatus;
  sessionId: string | null;
  agentId: string | null;
  contractId: string | null;
  contractVersion: number | null;
  expiresAt: string | null;
}

/** The runtime key's one-time exchange for a session token. Requires the task to already have an active contract. */
export async function createTaskSession(input: {
  credentialSecret: string;
  taskId: string;
  tokenHash: string;
  ttlSeconds: number;
}): Promise<CreateTaskSessionResult> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.create_task_session($1, $2::uuid, $3, $4::int)`,
    [input.credentialSecret, input.taskId, input.tokenHash, input.ttlSeconds],
  );
  const r = rows[0];
  return {
    status: r.cts_status as GatewayStatus,
    sessionId: (r.cts_session_id as string) ?? null,
    agentId: (r.cts_agent_id as string) ?? null,
    contractId: (r.cts_contract_id as string) ?? null,
    contractVersion: (r.cts_contract_version as number) ?? null,
    expiresAt: (r.cts_expires_at as string) ?? null,
  };
}

/** Self-revocation: authenticated by the session token itself, not the runtime key. Idempotent. */
export async function revokeTaskSession(input: {
  token: string;
  reason?: string;
}): Promise<"ok" | "already_revoked" | "not_found" | "invalid_token"> {
  const rows = await gatewayQuery<{ revoke_task_session: string }>(
    `select gateway.revoke_task_session($1, $2) as revoke_task_session`,
    [input.token, input.reason ?? null],
  );
  return rows[0].revoke_task_session as "ok" | "already_revoked" | "not_found" | "invalid_token";
}

export type TaskSessionInfoStatus =
  "ok" | "not_found" | "revoked" | "expired" | "credential_revoked" | "invalid_token";

export interface TaskSessionInfo {
  status: TaskSessionInfoStatus;
  sessionId: string | null;
  agentId: string | null;
  taskId: string | null;
  contractId: string | null;
  contractVersion: number | null;
  expiresAt: string | null;
}

/** Read-only introspection for GET /api/v1/sessions/current -- distinct reasons, unlike resolveCredential's collapsed statuses. */
export async function taskSessionInfo(token: string): Promise<TaskSessionInfo> {
  const rows = await gatewayQuery<Row>(`select * from gateway.task_session_info($1)`, [token]);
  const r = rows[0];
  return {
    status: r.tsi_status as TaskSessionInfoStatus,
    sessionId: (r.tsi_session_id as string) ?? null,
    agentId: (r.tsi_agent_id as string) ?? null,
    taskId: (r.tsi_task_id as string) ?? null,
    contractId: (r.tsi_contract_id as string) ?? null,
    contractVersion: (r.tsi_contract_version as number) ?? null,
    expiresAt: (r.tsi_expires_at as string) ?? null,
  };
}

export interface ResolvedCredential {
  status: GatewayStatus;
  tenantId: string | null;
  agentId: string | null;
  credentialId: string | null;
}

/**
 * Resolves EITHER an agent runtime key or a task-session token to the
 * tenant/agent it authenticates -- the same function every authorize/
 * execute/capability/approval RPC already calls internally. Exposed here
 * only for routes that need to check identity directly without going
 * through the full authorize pipeline, e.g. GET /api/v1/tasks/{taskId}/tools.
 */
export async function resolveCredential(secret: string): Promise<ResolvedCredential> {
  const rows = await gatewayQuery<Row>(`select * from gateway.resolve_credential($1)`, [secret]);
  const r = rows[0];
  return {
    status: r.rc_status as GatewayStatus,
    tenantId: (r.rc_tenant_id as string) ?? null,
    agentId: (r.rc_agent_id as string) ?? null,
    credentialId: (r.rc_credential_id as string) ?? null,
  };
}
