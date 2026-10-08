import { LINEAR_CONNECTOR_ID } from "@/lib/connectors/linear/connector";
import { closeGatewayPool } from "@/lib/gateway/db";
import { setConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";
import { createConnectorConnection, disconnectConnectorConnection } from "@/lib/gateway/rpc-connectors";

import { TENANT_A_ID, TENANT_B_ID, managementQuery } from "../support";

/** Real seeded auth.users ids (supabase/seed.sql) -- see gateway.actor_meets_role. */
export const ADMIN_A_USER_ID = "a0000000-0000-4000-8000-000000000002";

export interface LinearConnectionFixture {
  tenantId: string;
  connectionId: string;
  cleanup: () => Promise<void>;
}

export async function createLinearConnection(options: {
  tenantId: string;
  adminUserId: string;
  label: string;
}): Promise<LinearConnectionFixture> {
  const created = await createConnectorConnection({
    tenantId: options.tenantId,
    userId: options.adminUserId,
    connectorId: LINEAR_CONNECTOR_ID,
    name: options.label,
    environment: "development",
  });
  if (created.status !== "ok" || !created.connectionId) {
    throw new Error(`createLinearConnection: ${created.status}`);
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
        delete from public.task_connector_bindings where connector_id = '${LINEAR_CONNECTOR_ID}' and connection_id = '${connectionId}';
        delete from public.connector_connection_secrets where connection_id = '${connectionId}';
        delete from public.connector_connections where id = '${connectionId}';
      `);
    },
  };
}

export async function setLinearApiKey(fixture: LinearConnectionFixture, apiKey: string): Promise<void> {
  const result = await setConnectorSecret({
    tenantId: fixture.tenantId,
    userId: ADMIN_A_USER_ID,
    connectionId: fixture.connectionId,
    secretType: "api_key",
    plaintextSecret: apiKey,
  });
  if (result !== "ok") throw new Error(`setLinearApiKey: ${result}`);
}

export async function disconnectLinearConnection(
  fixture: LinearConnectionFixture,
  adminUserId: string,
): Promise<void> {
  const result = await disconnectConnectorConnection({
    tenantId: fixture.tenantId,
    userId: adminUserId,
    connectionId: fixture.connectionId,
  });
  if (result.status !== "ok") throw new Error(`disconnectLinearConnection: ${result.status}`);
}

export { TENANT_A_ID, TENANT_B_ID, closeGatewayPool };
