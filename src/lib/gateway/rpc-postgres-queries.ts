import "server-only";

import { gatewayQuery } from "./db";

/**
 * Typed wrappers over the postgres-query-definition lifecycle functions
 * (20261001000013_postgres_query_definitions.sql) -- the SQL-flavored
 * counterpart to rpc-custom-operations.ts. Draft/validate are developer+;
 * publish/retire are security_admin+.
 */

type Row = Record<string, unknown>;

export type PostgresQueryEffect = "read" | "write_create" | "write_update" | "write_delete" | "admin";

export interface CreatePostgresQueryDraftInput {
  tenantId: string;
  userId: string;
  connectionId: string;
  querySlug: string;
  name: string;
  description: string | null;
  sqlTemplate: string;
  effect: PostgresQueryEffect;
  inputSchema: Record<string, unknown>;
  timeoutMs: number;
  invocationLimit: number | null;
}

export async function createPostgresQueryDraft(
  input: CreatePostgresQueryDraftInput,
): Promise<{ status: string; queryId: string | null }> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.create_postgres_query_draft($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::jsonb, $10::int, $11::int)`,
    [
      input.tenantId,
      input.userId,
      input.connectionId,
      input.querySlug,
      input.name,
      input.description,
      input.sqlTemplate,
      input.effect,
      JSON.stringify(input.inputSchema),
      input.timeoutMs,
      input.invocationLimit,
    ],
  );
  return { status: rows[0].cpqd_status as string, queryId: (rows[0].cpqd_query_id as string) ?? null };
}

export interface UpdatePostgresQueryDraftInput {
  tenantId: string;
  userId: string;
  queryId: string;
  name: string | null;
  description: string | null;
  sqlTemplate: string | null;
  effect: string | null;
  inputSchema: Record<string, unknown> | null;
  timeoutMs: number | null;
  invocationLimit: number | null;
}

export async function updatePostgresQueryDraft(input: UpdatePostgresQueryDraftInput): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.update_postgres_query_draft($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9::int, $10::int) as status`,
    [
      input.tenantId,
      input.userId,
      input.queryId,
      input.name,
      input.description,
      input.sqlTemplate,
      input.effect,
      input.inputSchema ? JSON.stringify(input.inputSchema) : null,
      input.timeoutMs,
      input.invocationLimit,
    ],
  );
  return rows[0].status as string;
}

export async function validatePostgresQuery(input: {
  tenantId: string;
  userId: string;
  queryId: string;
}): Promise<{ status: string; inputSchemaHash: string | null; sqlTemplateHash: string | null }> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.validate_postgres_query($1::uuid, $2::uuid, $3::uuid)`,
    [input.tenantId, input.userId, input.queryId],
  );
  return {
    status: rows[0].vpq_status as string,
    inputSchemaHash: (rows[0].vpq_input_schema_hash as string) ?? null,
    sqlTemplateHash: (rows[0].vpq_sql_template_hash as string) ?? null,
  };
}

export async function publishPostgresQuery(input: {
  tenantId: string;
  userId: string;
  queryId: string;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.publish_postgres_query($1::uuid, $2::uuid, $3::uuid) as status`,
    [input.tenantId, input.userId, input.queryId],
  );
  return rows[0].status as string;
}

export async function retirePostgresQuery(input: {
  tenantId: string;
  userId: string;
  queryId: string;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.retire_postgres_query($1::uuid, $2::uuid, $3::uuid) as status`,
    [input.tenantId, input.userId, input.queryId],
  );
  return rows[0].status as string;
}

export async function deletePostgresQueryDraft(input: {
  tenantId: string;
  userId: string;
  queryId: string;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.delete_postgres_query_draft($1::uuid, $2::uuid, $3::uuid) as status`,
    [input.tenantId, input.userId, input.queryId],
  );
  return rows[0].status as string;
}

export interface PublishedPostgresQuery {
  queryId: string;
  toolName: string;
  sqlTemplate: string;
  effect: PostgresQueryEffect;
  inputSchema: Record<string, unknown>;
  timeoutMs: number;
  connectionStatus: string;
  connectionConfig: Record<string, unknown>;
}

/** Server-only; called from the Postgres connector, never from a client-facing route. Returns null for anything not currently published. */
export async function getPublishedPostgresQuery(
  connectionId: string,
  querySlug: string,
): Promise<PublishedPostgresQuery | null> {
  const rows = await gatewayQuery<Row>(`select * from gateway.get_published_postgres_query($1::uuid, $2)`, [
    connectionId,
    querySlug,
  ]);
  const r = rows[0];
  if (!r) return null;
  return {
    queryId: r.gppq_query_id as string,
    toolName: r.gppq_tool_name as string,
    sqlTemplate: r.gppq_sql_template as string,
    effect: r.gppq_effect as PostgresQueryEffect,
    inputSchema: r.gppq_input_schema as Record<string, unknown>,
    timeoutMs: r.gppq_timeout_ms as number,
    connectionStatus: r.gppq_connection_status as string,
    connectionConfig: (r.gppq_connection_config as Record<string, unknown>) ?? {},
  };
}

export interface TenantPublishedQuery {
  queryId: string;
  toolName: string;
  querySlug: string;
  name: string;
  description: string | null;
  effect: PostgresQueryEffect;
  inputSchema: Record<string, unknown>;
  inputSchemaHash: string | null;
  sqlTemplateHash: string | null;
  connectorId: string;
  connectionName: string;
  publishedAt: string | null;
}

/**
 * Every query this tenant may currently reference in a new plan: published,
 * on a still-active connection. Used to assemble the tenant-scoped registry
 * (src/lib/registry/tenant.ts), the same role
 * listPublishedCustomOperationsForTenant plays for Custom API.
 */
export async function listPublishedPostgresQueriesForTenant(
  tenantId: string,
): Promise<TenantPublishedQuery[]> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.list_published_postgres_queries_for_tenant($1::uuid)`,
    [tenantId],
  );
  return rows.map((r) => ({
    queryId: r.lppq_query_id as string,
    toolName: r.lppq_tool_name as string,
    querySlug: r.lppq_query_slug as string,
    name: r.lppq_name as string,
    description: (r.lppq_description as string) ?? null,
    effect: r.lppq_effect as PostgresQueryEffect,
    inputSchema: r.lppq_input_schema as Record<string, unknown>,
    inputSchemaHash: (r.lppq_input_schema_hash as string) ?? null,
    sqlTemplateHash: (r.lppq_sql_template_hash as string) ?? null,
    connectorId: r.lppq_connector_id as string,
    connectionName: r.lppq_connection_name as string,
    publishedAt: (r.lppq_published_at as string) ?? null,
  }));
}
