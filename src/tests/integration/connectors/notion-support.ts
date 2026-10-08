import { NOTION_CONNECTOR_ID } from "@/lib/connectors/notion/connector";
import { closeGatewayPool } from "@/lib/gateway/db";
import { setConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";
import { createConnectorConnection, disconnectConnectorConnection } from "@/lib/gateway/rpc-connectors";

import { TENANT_A_ID, TENANT_B_ID, managementQuery } from "../support";

/** Real seeded auth.users ids (supabase/seed.sql) -- see gateway.actor_meets_role. */
export const ADMIN_A_USER_ID = "a0000000-0000-4000-8000-000000000002";

export interface NotionConnectionFixture {
  tenantId: string;
  connectionId: string;
  cleanup: () => Promise<void>;
}

export async function createNotionConnection(options: {
  tenantId: string;
  adminUserId: string;
  label: string;
}): Promise<NotionConnectionFixture> {
  const created = await createConnectorConnection({
    tenantId: options.tenantId,
    userId: options.adminUserId,
    connectorId: NOTION_CONNECTOR_ID,
    name: options.label,
    environment: "development",
  });
  if (created.status !== "ok" || !created.connectionId) {
    throw new Error(`createNotionConnection: ${created.status}`);
  }
  const connectionId = created.connectionId;
  return {
    tenantId: options.tenantId,
    connectionId,
    cleanup: async () => {
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.connector_execution_receipts where connection_id = '${connectionId}';
        delete from public.connector_reservations where connection_id = '${connectionId}';
        delete from public.task_connector_bindings where connector_id = '${NOTION_CONNECTOR_ID}' and connection_id = '${connectionId}';
        delete from public.connector_connection_secrets where connection_id = '${connectionId}';
        delete from public.connector_connections where id = '${connectionId}';
      `);
    },
  };
}

export async function setNotionToken(fixture: NotionConnectionFixture, token: string): Promise<void> {
  const result = await setConnectorSecret({
    tenantId: fixture.tenantId,
    userId: ADMIN_A_USER_ID,
    connectionId: fixture.connectionId,
    secretType: "bearer_token",
    plaintextSecret: token,
  });
  if (result !== "ok") throw new Error(`setNotionToken: ${result}`);
}

export async function disconnectNotionConnection(
  fixture: NotionConnectionFixture,
  adminUserId: string,
): Promise<void> {
  const result = await disconnectConnectorConnection({
    tenantId: fixture.tenantId,
    userId: adminUserId,
    connectionId: fixture.connectionId,
  });
  if (result.status !== "ok") throw new Error(`disconnectNotionConnection: ${result.status}`);
}

export { TENANT_A_ID, TENANT_B_ID, closeGatewayPool };
