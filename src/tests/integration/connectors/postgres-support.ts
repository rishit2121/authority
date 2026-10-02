import { randomUUID } from "node:crypto";

import { toPostgresConnectorId } from "@/lib/connectors/postgres/connection-id";
import { closeGatewayPool } from "@/lib/gateway/db";
import { setConnectorSecret, updateConnectorConnectionConfig } from "@/lib/gateway/rpc-connector-secrets";
import { createConnectorConnection, disconnectConnectorConnection } from "@/lib/gateway/rpc-connectors";
import {
  createPostgresQueryDraft,
  publishPostgresQuery,
  validatePostgresQuery,
  type CreatePostgresQueryDraftInput,
} from "@/lib/gateway/rpc-postgres-queries";

import { TENANT_A_ID, TENANT_B_ID, managementQuery } from "../support";

/** Real seeded auth.users ids (supabase/seed.sql) -- see gateway.actor_meets_role. */
export const ADMIN_A_USER_ID = "a0000000-0000-4000-8000-000000000002";
export const DEV_A_USER_ID = "a0000000-0000-4000-8000-000000000003";
export const OWNER_B_USER_ID = "b0000000-0000-4000-8000-000000000001";

export interface PostgresConnectionFixture {
  tenantId: string;
  connectionId: string;
  connectorId: string;
  cleanup: () => Promise<void>;
}

/** Creates a Postgres connection for the given tenant, with fixture config -- never resolved over the network, since every test injects its own `runQuery`. */
export async function createPostgresConnection(options: {
  tenantId: string;
  adminUserId: string;
  label: string;
}): Promise<PostgresConnectionFixture> {
  const connectionId = randomUUID();
  const connectorId = toPostgresConnectorId(connectionId);
  const created = await createConnectorConnection({
    tenantId: options.tenantId,
    userId: options.adminUserId,
    connectorId,
    name: options.label,
    environment: "development",
    connectionId,
  });
  if (created.status !== "ok") {
    throw new Error(`createPostgresConnection: ${created.status}`);
  }
  const configured = await updateConnectorConnectionConfig({
    tenantId: options.tenantId,
    userId: options.adminUserId,
    connectionId,
    config: { host: "postgres-fixture.invalid", port: 5432, database: "app", sslmode: "require" },
  });
  if (configured !== "ok") {
    throw new Error(`createPostgresConnection: config ${configured}`);
  }
  return {
    tenantId: options.tenantId,
    connectionId,
    connectorId,
    cleanup: async () => {
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.connector_execution_receipts where connection_id = '${connectionId}';
        delete from public.connector_reservations where connection_id = '${connectionId}';
        delete from public.task_connector_bindings where connector_id = '${connectorId}';
        delete from public.postgres_query_definitions where connection_id = '${connectionId}';
        delete from public.connector_connection_secrets where connection_id = '${connectionId}';
        delete from public.connector_connections where id = '${connectionId}';
      `);
    },
  };
}

export interface PublishedQueryFixture {
  querySlug: string;
  toolName: string;
}

/** Drafts, validates, and publishes one query in a single call -- the full lifecycle a real setup wizard drives, minus the UI. */
export async function publishQuery(
  fixture: PostgresConnectionFixture,
  options: {
    querySlug: string;
    name: string;
    sqlTemplate: string;
    effect: CreatePostgresQueryDraftInput["effect"];
    inputSchema: CreatePostgresQueryDraftInput["inputSchema"];
  },
): Promise<PublishedQueryFixture> {
  const draft = await createPostgresQueryDraft({
    tenantId: fixture.tenantId,
    userId: DEV_A_USER_ID,
    connectionId: fixture.connectionId,
    querySlug: options.querySlug,
    name: options.name,
    description: null,
    sqlTemplate: options.sqlTemplate,
    effect: options.effect,
    inputSchema: options.inputSchema,
    timeoutMs: 5000,
    invocationLimit: null,
  });
  if (draft.status !== "ok" || !draft.queryId) {
    throw new Error(`publishQuery: draft ${draft.status}`);
  }
  const validated = await validatePostgresQuery({
    tenantId: fixture.tenantId,
    userId: DEV_A_USER_ID,
    queryId: draft.queryId,
  });
  if (validated.status !== "ok") {
    throw new Error(`publishQuery: validate ${validated.status}`);
  }
  const published = await publishPostgresQuery({
    tenantId: fixture.tenantId,
    userId: ADMIN_A_USER_ID,
    queryId: draft.queryId,
  });
  if (published !== "ok") {
    throw new Error(`publishQuery: publish ${published}`);
  }
  return { querySlug: options.querySlug, toolName: `${fixture.connectorId}.${options.querySlug}` };
}

export async function setPostgresCredentials(
  fixture: PostgresConnectionFixture,
  username: string,
  password: string,
): Promise<void> {
  const [u, p] = await Promise.all([
    setConnectorSecret({
      tenantId: fixture.tenantId,
      userId: ADMIN_A_USER_ID,
      connectionId: fixture.connectionId,
      secretType: "basic_username",
      plaintextSecret: username,
    }),
    setConnectorSecret({
      tenantId: fixture.tenantId,
      userId: ADMIN_A_USER_ID,
      connectionId: fixture.connectionId,
      secretType: "basic_password",
      plaintextSecret: password,
    }),
  ]);
  if (u !== "ok") throw new Error(`setPostgresCredentials: username ${u}`);
  if (p !== "ok") throw new Error(`setPostgresCredentials: password ${p}`);
}

export async function disconnectPostgresConnection(
  fixture: PostgresConnectionFixture,
  adminUserId: string,
): Promise<void> {
  const result = await disconnectConnectorConnection({
    tenantId: fixture.tenantId,
    userId: adminUserId,
    connectionId: fixture.connectionId,
  });
  if (result.status !== "ok") throw new Error(`disconnectPostgresConnection: ${result.status}`);
}

export { TENANT_A_ID, TENANT_B_ID, closeGatewayPool };
