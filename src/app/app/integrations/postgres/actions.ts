"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { toPostgresConnectorId } from "@/lib/connectors/postgres/connection-id";
import { validatePostgresHost } from "@/lib/connectors/postgres/network-guard";
import { validateQueryDefinition } from "@/lib/connectors/postgres/validate";
import {
  getConnectorConnectionConfig,
  setConnectorSecret,
  updateConnectorConnectionConfig,
} from "@/lib/gateway/rpc-connector-secrets";
import { createConnectorConnection, disconnectConnectorConnection } from "@/lib/gateway/rpc-connectors";
import {
  createPostgresQueryDraft,
  deletePostgresQueryDraft,
  publishPostgresQuery,
  retirePostgresQuery,
  validatePostgresQuery,
  type PostgresQueryEffect,
} from "@/lib/gateway/rpc-postgres-queries";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export interface PostgresActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const PAGE = "/app/integrations/postgres";

const FRIENDLY: Record<string, string> = {
  forbidden: "Your role does not allow this. An admin is required.",
  already_connected: "A connection with that id already exists.",
  not_found: "That record was not found.",
  connection_not_found: "That connection was not found or is disconnected.",
  no_draft: "There is no draft query to act on.",
  not_draft: "This query is no longer a draft and cannot be edited.",
  not_validated: "Validate the query before publishing it.",
  not_published: "Only a published query can be retired.",
  slug_taken: "A query with that slug already exists on this connection.",
};
const friendly = (code: string) => FRIENDLY[code] ?? "The request could not be completed.";

export async function createPostgresConnectionAction(input: {
  name: string;
  host: string;
  port: number;
  database: string;
  sslmode: "require" | "disable";
}): Promise<PostgresActionResult> {
  try {
    await validatePostgresHost(input.host);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "That host is not allowed." };
  }
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const connectionId = randomUUID();
  const connectorId = toPostgresConnectorId(connectionId);
  const created = await createConnectorConnection({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectorId,
    name: input.name,
    environment: "development",
    connectionId,
  });
  if (created.status !== "ok") return { ok: false, error: friendly(created.status) };
  const configured = await updateConnectorConnectionConfig({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId,
    config: { host: input.host, port: input.port, database: input.database, sslmode: input.sslmode },
  });
  revalidatePath(PAGE);
  if (configured !== "ok") return { ok: false, error: friendly(configured) };
  return { ok: true, message: `Connection created (${connectorId}). Add its credentials below.` };
}

export async function setPostgresCredentialsAction(
  connectionId: string,
  username: string,
  password: string,
): Promise<PostgresActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const [u, p] = await Promise.all([
    setConnectorSecret({
      tenantId: identity.tenant.tenantId,
      userId: identity.userId,
      connectionId,
      secretType: "basic_username",
      plaintextSecret: username,
    }),
    setConnectorSecret({
      tenantId: identity.tenant.tenantId,
      userId: identity.userId,
      connectionId,
      secretType: "basic_password",
      plaintextSecret: password,
    }),
  ]);
  revalidatePath(PAGE);
  if (u !== "ok") return { ok: false, error: friendly(u) };
  if (p !== "ok") return { ok: false, error: friendly(p) };
  return { ok: true, message: "Credentials saved." };
}

export async function disconnectPostgresConnectionAction(
  connectionId: string,
): Promise<PostgresActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await disconnectConnectorConnection({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId,
  });
  revalidatePath(PAGE);
  if (result.status !== "ok") return { ok: false, error: friendly(result.status) };
  return {
    ok: true,
    message: `Disconnected; ${result.revokedCapabilities ?? 0} live capabilit${result.revokedCapabilities === 1 ? "y" : "ies"} revoked.`,
  };
}

export interface CreateQueryInput {
  connectionId: string;
  querySlug: string;
  name: string;
  sqlTemplate: string;
  effect: PostgresQueryEffect;
  fields: Array<{
    key: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    identifiesResource: boolean;
  }>;
}

export interface PostgresValidationResult extends PostgresActionResult {
  issues?: Array<{ field: string; message: string }>;
}

/**
 * Drafts a query with an arbitrary (1-20) field list -- structurally checked
 * here, before the RPC is even called, by the same rules
 * src/lib/connectors/postgres/validate.ts enforces again independently at
 * the database layer. See that module's own comment on the two-layer
 * relationship, mirroring Custom API's createCustomOperationAction.
 */
export async function createPostgresQueryAction(input: CreateQueryInput): Promise<PostgresValidationResult> {
  const inputSchema = { schemaVersion: 1 as const, fields: input.fields };
  const structural = validateQueryDefinition({
    sqlTemplate: input.sqlTemplate,
    effect: input.effect,
    inputSchema,
  });
  if (!structural.ok) {
    return {
      ok: false,
      error: structural.issues[0]?.message ?? "Invalid query definition.",
      issues: structural.issues,
    };
  }

  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const draft = await createPostgresQueryDraft({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId: input.connectionId,
    querySlug: input.querySlug,
    name: input.name,
    description: null,
    sqlTemplate: input.sqlTemplate,
    effect: input.effect,
    inputSchema,
    timeoutMs: 5000,
    invocationLimit: null,
  });
  revalidatePath(PAGE);
  if (draft.status !== "ok") return { ok: false, error: friendly(draft.status) };
  return { ok: true, message: "Draft created." };
}

export async function validatePostgresQueryAction(queryId: string): Promise<PostgresActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await validatePostgresQuery({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    queryId,
  });
  revalidatePath(PAGE);
  if (result.status !== "ok") return { ok: false, error: friendly(result.status) };
  return { ok: true, message: "Validated. An administrator can now publish it." };
}

export async function publishPostgresQueryAction(queryId: string): Promise<PostgresActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await publishPostgresQuery({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    queryId,
  });
  revalidatePath(PAGE);
  if (result !== "ok") return { ok: false, error: friendly(result) };
  return { ok: true, message: "Published. This definition is now immutable." };
}

export async function retirePostgresQueryAction(queryId: string): Promise<PostgresActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await retirePostgresQuery({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    queryId,
  });
  revalidatePath(PAGE);
  if (result !== "ok") return { ok: false, error: friendly(result) };
  return { ok: true, message: "Retired. Existing contracts that already pinned it are unaffected." };
}

export async function deletePostgresQueryDraftAction(queryId: string): Promise<PostgresActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await deletePostgresQueryDraft({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    queryId,
  });
  revalidatePath(PAGE);
  if (result !== "ok") return { ok: false, error: friendly(result) };
  return { ok: true, message: "Draft deleted." };
}

export async function updatePostgresConnectionConfigAction(
  connectionId: string,
  host: string,
  port: number,
  database: string,
  sslmode: "require" | "disable",
): Promise<PostgresActionResult> {
  try {
    await validatePostgresHost(host);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "That host is not allowed." };
  }
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const existing = await getConnectorConnectionConfig(connectionId);
  const result = await updateConnectorConnectionConfig({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId,
    config: { ...(existing?.config ?? {}), host, port, database, sslmode },
  });
  revalidatePath(PAGE);
  return result === "ok"
    ? { ok: true, message: "Connection settings updated." }
    : { ok: false, error: friendly(result) };
}
