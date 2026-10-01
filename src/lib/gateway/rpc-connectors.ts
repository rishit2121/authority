import "server-only";

import { gatewayQuery } from "./db";
import type { GatewayStatus } from "./rpc";

/**
 * Typed wrappers over the generic connector `gateway.*` functions
 * (20261001000001_connector_framework_schema.sql) — the provider-neutral
 * counterpart to rpc-github.ts, used by every connector except GitHub. Like
 * rpc-github.ts, none of these returns or logs a request's raw arguments,
 * and no token or key ever passes through them.
 */

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

export type ConnectorConnectionStatus = "active" | "suspended" | "needs_attention" | "disconnected";

export async function createConnectorConnection(input: {
  tenantId: string;
  userId: string;
  connectorId: string;
  name: string;
  environment: "development" | "staging" | "production";
  /** Only Custom API supplies this -- see 20261001000008_connector_connection_explicit_id.sql. */
  connectionId?: string;
}): Promise<{ status: string; connectionId: string | null }> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.create_connector_connection($1::uuid, $2::uuid, $3, $4, $5::public.tenant_environment, $6::uuid)`,
    [input.tenantId, input.userId, input.connectorId, input.name, input.environment, input.connectionId ?? null],
  );
  return { status: rows[0].cc_status as string, connectionId: (rows[0].cc_connection_id as string) ?? null };
}

export async function updateConnectorConnectionHealth(input: {
  tenantId: string;
  connectionId: string;
  status: ConnectorConnectionStatus;
  reasons: string[];
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.update_connector_connection_health($1::uuid, $2::uuid, $3::public.connector_connection_status, $4::text[]) as status`,
    [input.tenantId, input.connectionId, input.status, input.reasons],
  );
  return rows[0].status as string;
}

export async function disconnectConnectorConnection(input: {
  tenantId: string;
  userId: string;
  connectionId: string;
}): Promise<{ status: string; revokedCapabilities: number | null }> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.disconnect_connector_connection($1::uuid, $2::uuid, $3::uuid)`,
    [input.tenantId, input.userId, input.connectionId],
  );
  return {
    status: rows[0].dc_status as string,
    revokedCapabilities: (rows[0].dc_revoked_capabilities as number) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Two-phase execution
// ---------------------------------------------------------------------------

export interface ReserveConnectorResult {
  status: GatewayStatus;
  result: "reserved" | "rejected" | "in_progress" | "replayed" | null;
  reasonCode: string | null;
  executionId: string | null;
  capabilityId: string | null;
  taskId: string | null;
  agentId: string | null;
  connectorId: string | null;
  connectionId: string | null;
  leaseExpiresAt: string | null;
  previousStatus: string | null;
  previousReceipt: Record<string, unknown> | null;
}

export async function reserveConnectorExecution(input: {
  credentialSecret: string;
  tokenHash: string;
  tool: string;
  operation: string;
  resource: string | null;
  args: Record<string, unknown>;
  idempotencyKey: string;
  executionMode: "mock" | "live";
  leaseSeconds: number;
}): Promise<ReserveConnectorResult> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.reserve_connector_execution($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::int)`,
    [
      input.credentialSecret,
      input.tokenHash,
      input.tool,
      input.operation,
      input.resource,
      JSON.stringify(input.args),
      input.idempotencyKey,
      input.executionMode,
      input.leaseSeconds,
    ],
  );
  const r = rows[0];
  return {
    status: r.rce_status as GatewayStatus,
    result: (r.rce_result as ReserveConnectorResult["result"]) ?? null,
    reasonCode: (r.rce_reason_code as string) ?? null,
    executionId: (r.rce_execution_id as string) ?? null,
    capabilityId: (r.rce_capability_id as string) ?? null,
    taskId: (r.rce_task_id as string) ?? null,
    agentId: (r.rce_agent_id as string) ?? null,
    connectorId: (r.rce_connector_id as string) ?? null,
    connectionId: (r.rce_connection_id as string) ?? null,
    leaseExpiresAt: (r.rce_lease_expires_at as string) ?? null,
    previousStatus: (r.rce_prev_category as string) ?? null,
    previousReceipt: (r.rce_prev_receipt as Record<string, unknown>) ?? null,
  };
}

export async function markConnectorDispatched(input: {
  executionId: string;
  agentId: string;
}): Promise<{ status: string; reason: string | null }> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.mark_connector_dispatched($1::uuid, $2::uuid)`,
    [input.executionId, input.agentId],
  );
  return { status: rows[0].mcd_status as string, reason: (rows[0].mcd_reason as string) ?? null };
}

export type ConnectorResultCategory =
  "succeeded" | "succeeded_noop" | "failed" | "indeterminate" | "released";

export interface FinishConnectorInput {
  executionId: string;
  agentId: string;
  category: ConnectorResultCategory;
  reasonCode: string | null;
  providerRequestId: string | null;
  httpStatusClass: number | null;
  resourceIds: Record<string, unknown>;
  startedAt: Date;
  redaction: Record<string, unknown>;
}

export async function finishConnectorExecution(
  input: FinishConnectorInput,
): Promise<{ status: string; receiptId: string | null; finalStatus: string | null }> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.finish_connector_execution($1::uuid, $2::uuid, $3, $4, $5, $6::smallint, $7::jsonb, $8::timestamptz, $9::jsonb)`,
    [
      input.executionId,
      input.agentId,
      input.category,
      input.reasonCode,
      input.providerRequestId,
      input.httpStatusClass,
      JSON.stringify({ schemaVersion: 1, ...input.resourceIds }),
      input.startedAt.toISOString(),
      JSON.stringify({ schemaVersion: 1, ...input.redaction }),
    ],
  );
  return {
    status: rows[0].fce_status as string,
    receiptId: (rows[0].fce_receipt_id as string) ?? null,
    finalStatus: (rows[0].fce_final_status as string) ?? null,
  };
}

export async function reconcileExpiredConnectorReservations(limit = 50): Promise<number> {
  const rows = await gatewayQuery<Row>(
    `select gateway.reconcile_expired_connector_reservations($1::int) as n`,
    [limit],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function resolveConnectorIndeterminate(input: {
  tenantId: string;
  userId: string;
  executionId: string;
  outcome: "executed" | "not_executed";
  note: string;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.resolve_connector_indeterminate($1::uuid, $2::uuid, $3::uuid, $4, $5) as status`,
    [input.tenantId, input.userId, input.executionId, input.outcome, input.note],
  );
  return rows[0].status as string;
}
