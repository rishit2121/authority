import { SLACK_CONNECTOR_ID } from "@/lib/connectors/slack/connector";
import { closeGatewayPool } from "@/lib/gateway/db";
import { setConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";
import { createConnectorConnection, disconnectConnectorConnection } from "@/lib/gateway/rpc-connectors";

import { TENANT_A_ID, TENANT_B_ID, managementQuery } from "../support";

/** Real seeded auth.users ids (supabase/seed.sql) -- see gateway.actor_meets_role. */
export const ADMIN_A_USER_ID = "a0000000-0000-4000-8000-000000000002";

export interface SlackConnectionFixture {
  tenantId: string;
  connectionId: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a Slack connection for the given tenant. Like Stripe (unlike
 * Custom API), Slack's `connector_id` is the fixed constant `"slack"` --
 * only one such connection may be active per tenant at a time
 * (connector_connections_one_active_per_connector).
 */
export async function createSlackConnection(options: {
  tenantId: string;
  adminUserId: string;
  label: string;
}): Promise<SlackConnectionFixture> {
  const created = await createConnectorConnection({
    tenantId: options.tenantId,
    userId: options.adminUserId,
    connectorId: SLACK_CONNECTOR_ID,
    name: options.label,
    environment: "development",
  });
  if (created.status !== "ok" || !created.connectionId) {
    throw new Error(`createSlackConnection: ${created.status}`);
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
        delete from public.task_connector_bindings where connector_id = '${SLACK_CONNECTOR_ID}' and connection_id = '${connectionId}';
        delete from public.connector_connection_secrets where connection_id = '${connectionId}';
        delete from public.connector_connections where id = '${connectionId}';
      `);
    },
  };
}

export async function setSlackBotToken(fixture: SlackConnectionFixture, token: string): Promise<void> {
  const result = await setConnectorSecret({
    tenantId: fixture.tenantId,
    userId: ADMIN_A_USER_ID,
    connectionId: fixture.connectionId,
    secretType: "bearer_token",
    plaintextSecret: token,
  });
  if (result !== "ok") throw new Error(`setSlackBotToken: ${result}`);
}

export async function disconnectSlackConnection(
  fixture: SlackConnectionFixture,
  adminUserId: string,
): Promise<void> {
  const result = await disconnectConnectorConnection({
    tenantId: fixture.tenantId,
    userId: adminUserId,
    connectionId: fixture.connectionId,
  });
  if (result.status !== "ok") throw new Error(`disconnectSlackConnection: ${result.status}`);
}

export { TENANT_A_ID, TENANT_B_ID, closeGatewayPool };
