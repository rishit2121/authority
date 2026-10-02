import { GMAIL_CONNECTOR_ID } from "@/lib/connectors/gmail/connector";
import { closeGatewayPool } from "@/lib/gateway/db";
import { setConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";
import { createConnectorConnection, disconnectConnectorConnection } from "@/lib/gateway/rpc-connectors";

import { TENANT_A_ID, TENANT_B_ID, managementQuery } from "../support";

/** Real seeded auth.users ids (supabase/seed.sql) -- see gateway.actor_meets_role. */
export const ADMIN_A_USER_ID = "a0000000-0000-4000-8000-000000000002";

export interface GmailConnectionFixture {
  tenantId: string;
  connectionId: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a Gmail connection for the given tenant. Like Stripe/Slack,
 * `connector_id` is the fixed constant `"gmail"` -- only one such connection
 * may be active per tenant at a time
 * (connector_connections_one_active_per_connector). This helper seeds the
 * refresh token directly via `setConnectorSecret` rather than driving the
 * real OAuth redirect/callback dance, exactly the same scope boundary
 * stripe-support.ts/slack-support.ts draw for a pasted credential -- the
 * OAuth routes themselves (connect/callback) are exercised by hand reasoning
 * and typecheck, not by an automated browser-redirect test, a known,
 * disclosed limitation of this pass.
 */
export async function createGmailConnection(options: {
  tenantId: string;
  adminUserId: string;
  label: string;
}): Promise<GmailConnectionFixture> {
  const created = await createConnectorConnection({
    tenantId: options.tenantId,
    userId: options.adminUserId,
    connectorId: GMAIL_CONNECTOR_ID,
    name: options.label,
    environment: "development",
  });
  if (created.status !== "ok" || !created.connectionId) {
    throw new Error(`createGmailConnection: ${created.status}`);
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
        delete from public.task_connector_bindings where connector_id = '${GMAIL_CONNECTOR_ID}' and connection_id = '${connectionId}';
        delete from public.connector_connection_secrets where connection_id = '${connectionId}';
        delete from public.connector_connections where id = '${connectionId}';
      `);
    },
  };
}

export async function setGmailRefreshToken(
  fixture: GmailConnectionFixture,
  refreshToken: string,
): Promise<void> {
  const result = await setConnectorSecret({
    tenantId: fixture.tenantId,
    userId: ADMIN_A_USER_ID,
    connectionId: fixture.connectionId,
    secretType: "oauth_refresh_token",
    plaintextSecret: refreshToken,
  });
  if (result !== "ok") throw new Error(`setGmailRefreshToken: ${result}`);
}

export async function disconnectGmailConnection(
  fixture: GmailConnectionFixture,
  adminUserId: string,
): Promise<void> {
  const result = await disconnectConnectorConnection({
    tenantId: fixture.tenantId,
    userId: adminUserId,
    connectionId: fixture.connectionId,
  });
  if (result.status !== "ok") throw new Error(`disconnectGmailConnection: ${result.status}`);
}

export { TENANT_A_ID, TENANT_B_ID, closeGatewayPool };
