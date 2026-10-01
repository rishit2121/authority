import "server-only";

import { gatewayQuery } from "./db";

/**
 * Typed wrappers over the custom-operation-definition lifecycle functions
 * (20261001000005_custom_operations.sql). Draft/validate are developer+;
 * publish/retire are security_admin+ — the one privileged, trust-conferring
 * step in this whole lifecycle. See that migration's own module doc.
 */

type Row = Record<string, unknown>;

export interface CreateCustomOperationDraftInput {
  tenantId: string;
  userId: string;
  connectionId: string;
  operationSlug: string;
  name: string;
  description: string | null;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pathTemplate: string;
  effect: "read" | "write_create" | "write_update" | "write_delete" | "admin";
  inputSchema: Record<string, unknown>;
  requestMapping: Record<string, unknown>;
  authType: "none" | "bearer" | "api_key_header" | "basic";
  authConfig: Record<string, unknown>;
  timeoutMs: number;
  invocationLimit: number | null;
}

export async function createCustomOperationDraft(
  input: CreateCustomOperationDraftInput,
): Promise<{ status: string; operationId: string | null }> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.create_custom_operation_draft($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13::jsonb, $14::int, $15::int)`,
    [
      input.tenantId,
      input.userId,
      input.connectionId,
      input.operationSlug,
      input.name,
      input.description,
      input.method,
      input.pathTemplate,
      input.effect,
      JSON.stringify(input.inputSchema),
      JSON.stringify(input.requestMapping),
      input.authType,
      JSON.stringify(input.authConfig),
      input.timeoutMs,
      input.invocationLimit,
    ],
  );
  return { status: rows[0].ccod_status as string, operationId: (rows[0].ccod_operation_id as string) ?? null };
}

export interface UpdateCustomOperationDraftInput {
  tenantId: string;
  userId: string;
  operationId: string;
  name: string | null;
  description: string | null;
  method: string | null;
  pathTemplate: string | null;
  effect: string | null;
  inputSchema: Record<string, unknown> | null;
  requestMapping: Record<string, unknown> | null;
  authType: string | null;
  authConfig: Record<string, unknown> | null;
  timeoutMs: number | null;
  invocationLimit: number | null;
}

export async function updateCustomOperationDraft(input: UpdateCustomOperationDraftInput): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.update_custom_operation_draft($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12::jsonb, $13::int, $14::int) as status`,
    [
      input.tenantId,
      input.userId,
      input.operationId,
      input.name,
      input.description,
      input.method,
      input.pathTemplate,
      input.effect,
      input.inputSchema ? JSON.stringify(input.inputSchema) : null,
      input.requestMapping ? JSON.stringify(input.requestMapping) : null,
      input.authType,
      input.authConfig ? JSON.stringify(input.authConfig) : null,
      input.timeoutMs,
      input.invocationLimit,
    ],
  );
  return rows[0].status as string;
}

export async function validateCustomOperation(input: {
  tenantId: string;
  userId: string;
  operationId: string;
}): Promise<{ status: string; inputSchemaHash: string | null; requestMappingHash: string | null }> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.validate_custom_operation($1::uuid, $2::uuid, $3::uuid)`,
    [input.tenantId, input.userId, input.operationId],
  );
  return {
    status: rows[0].vco_status as string,
    inputSchemaHash: (rows[0].vco_input_schema_hash as string) ?? null,
    requestMappingHash: (rows[0].vco_request_mapping_hash as string) ?? null,
  };
}

export async function publishCustomOperation(input: {
  tenantId: string;
  userId: string;
  operationId: string;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(`select gateway.publish_custom_operation($1::uuid, $2::uuid, $3::uuid) as status`, [
    input.tenantId,
    input.userId,
    input.operationId,
  ]);
  return rows[0].status as string;
}

export async function retireCustomOperation(input: {
  tenantId: string;
  userId: string;
  operationId: string;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(`select gateway.retire_custom_operation($1::uuid, $2::uuid, $3::uuid) as status`, [
    input.tenantId,
    input.userId,
    input.operationId,
  ]);
  return rows[0].status as string;
}

export interface PublishedCustomOperation {
  operationId: string;
  toolName: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pathTemplate: string;
  effect: "read" | "write_create" | "write_update" | "write_delete" | "admin";
  inputSchema: Record<string, unknown>;
  requestMapping: Record<string, unknown>;
  authType: "none" | "bearer" | "api_key_header" | "basic";
  authConfig: Record<string, unknown>;
  timeoutMs: number;
  connectionStatus: string;
  connectionConfig: Record<string, unknown>;
}

/** Server-only; called from the Custom API connector, never from a client-facing route. Returns null for anything not currently published -- draft, validated-but-unpublished, and retired are all indistinguishable from "does not exist" here. */
export async function getPublishedCustomOperation(
  connectionId: string,
  operationSlug: string,
): Promise<PublishedCustomOperation | null> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.get_published_custom_operation($1::uuid, $2)`,
    [connectionId, operationSlug],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    operationId: r.gpco_operation_id as string,
    toolName: r.gpco_tool_name as string,
    method: r.gpco_method as PublishedCustomOperation["method"],
    pathTemplate: r.gpco_path_template as string,
    effect: r.gpco_effect as PublishedCustomOperation["effect"],
    inputSchema: r.gpco_input_schema as Record<string, unknown>,
    requestMapping: r.gpco_request_mapping as Record<string, unknown>,
    authType: r.gpco_auth_type as PublishedCustomOperation["authType"],
    authConfig: r.gpco_auth_config as Record<string, unknown>,
    timeoutMs: r.gpco_timeout_ms as number,
    connectionStatus: r.gpco_connection_status as string,
    connectionConfig: (r.gpco_connection_config as Record<string, unknown>) ?? {},
  };
}

export async function deleteCustomOperationDraft(input: {
  tenantId: string;
  userId: string;
  operationId: string;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.delete_custom_operation_draft($1::uuid, $2::uuid, $3::uuid) as status`,
    [input.tenantId, input.userId, input.operationId],
  );
  return rows[0].status as string;
}
