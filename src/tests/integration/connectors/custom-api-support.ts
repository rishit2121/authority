import { randomUUID } from "node:crypto";

import { toCustomApiConnectorId } from "@/lib/connectors/custom-api/connection-id";
import { closeGatewayPool } from "@/lib/gateway/db";
import { createConnectorConnection, disconnectConnectorConnection } from "@/lib/gateway/rpc-connectors";
import { setConnectorSecret, updateConnectorConnectionConfig } from "@/lib/gateway/rpc-connector-secrets";
import {
  createCustomOperationDraft,
  publishCustomOperation,
  validateCustomOperation,
  type CreateCustomOperationDraftInput,
} from "@/lib/gateway/rpc-custom-operations";

import { TENANT_A_ID, TENANT_B_ID, managementQuery } from "../support";

/** Real seeded auth.users ids (supabase/seed.sql) -- see gateway.actor_meets_role, which checks tenant_memberships.user_id against exactly these. */
export const ADMIN_A_USER_ID = "a0000000-0000-4000-8000-000000000002";
export const DEV_A_USER_ID = "a0000000-0000-4000-8000-000000000003";
export const OWNER_B_USER_ID = "b0000000-0000-4000-8000-000000000001";

export interface CustomApiConnectionFixture {
  tenantId: string;
  connectionId: string;
  connectorId: string;
  cleanup: () => Promise<void>;
}

/** Creates a Custom API connection for the given tenant, with a fixture base URL -- never resolved over the network in these tests, since every test injects its own `fetch`. */
export async function createCustomApiConnection(options: {
  tenantId: string;
  adminUserId: string;
  label: string;
  baseUrl?: string;
}): Promise<CustomApiConnectionFixture> {
  const connectionId = randomUUID();
  const connectorId = toCustomApiConnectorId(connectionId);
  const created = await createConnectorConnection({
    tenantId: options.tenantId,
    userId: options.adminUserId,
    connectorId,
    name: options.label,
    environment: "development",
    connectionId,
  });
  if (created.status !== "ok") {
    throw new Error(`createCustomApiConnection: ${created.status}`);
  }
  const configured = await updateConnectorConnectionConfig({
    tenantId: options.tenantId,
    userId: options.adminUserId,
    connectionId,
    config: { baseUrl: options.baseUrl ?? "https://widget-orders.fixture.test" },
  });
  if (configured !== "ok") {
    throw new Error(`createCustomApiConnection: config ${configured}`);
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
        delete from public.custom_operation_definitions where connection_id = '${connectionId}';
        delete from public.connector_connection_secrets where connection_id = '${connectionId}';
        delete from public.connector_connections where id = '${connectionId}';
      `);
    },
  };
}

export interface PublishedOperationFixture {
  operationSlug: string;
  toolName: string;
}

/** Drafts, validates, and publishes one operation in a single call -- the full lifecycle a real setup wizard drives, minus the UI. */
export async function publishOperation(
  fixture: CustomApiConnectionFixture,
  options: {
    operationSlug: string;
    name: string;
    method: CreateCustomOperationDraftInput["method"];
    pathTemplate: string;
    effect: CreateCustomOperationDraftInput["effect"];
    inputSchema: CreateCustomOperationDraftInput["inputSchema"];
    authType?: CreateCustomOperationDraftInput["authType"];
  },
): Promise<PublishedOperationFixture> {
  const draft = await createCustomOperationDraft({
    tenantId: fixture.tenantId,
    userId: DEV_A_USER_ID,
    connectionId: fixture.connectionId,
    operationSlug: options.operationSlug,
    name: options.name,
    description: null,
    method: options.method,
    pathTemplate: options.pathTemplate,
    effect: options.effect,
    inputSchema: options.inputSchema,
    requestMapping: { schemaVersion: 1 },
    authType: options.authType ?? "none",
    authConfig: { schemaVersion: 1 },
    timeoutMs: 5000,
    invocationLimit: null,
  });
  if (draft.status !== "ok" || !draft.operationId) {
    throw new Error(`publishOperation: draft ${draft.status}`);
  }
  const validated = await validateCustomOperation({
    tenantId: fixture.tenantId,
    userId: DEV_A_USER_ID,
    operationId: draft.operationId,
  });
  if (validated.status !== "ok") {
    throw new Error(`publishOperation: validate ${validated.status}`);
  }
  const published = await publishCustomOperation({
    tenantId: fixture.tenantId,
    userId: ADMIN_A_USER_ID,
    operationId: draft.operationId,
  });
  if (published !== "ok") {
    throw new Error(`publishOperation: publish ${published}`);
  }
  return {
    operationSlug: options.operationSlug,
    toolName: `${fixture.connectorId}.${options.operationSlug}`,
  };
}

export async function setBearerSecret(fixture: CustomApiConnectionFixture, token: string): Promise<void> {
  const result = await setConnectorSecret({
    tenantId: fixture.tenantId,
    userId: ADMIN_A_USER_ID,
    connectionId: fixture.connectionId,
    secretType: "bearer_token",
    plaintextSecret: token,
  });
  if (result !== "ok") throw new Error(`setBearerSecret: ${result}`);
}

export async function disconnectCustomApiConnection(
  fixture: CustomApiConnectionFixture,
  adminUserId: string,
): Promise<void> {
  const result = await disconnectConnectorConnection({
    tenantId: fixture.tenantId,
    userId: adminUserId,
    connectionId: fixture.connectionId,
  });
  if (result.status !== "ok") throw new Error(`disconnectCustomApiConnection: ${result.status}`);
}

export { TENANT_A_ID, TENANT_B_ID, closeGatewayPool };
