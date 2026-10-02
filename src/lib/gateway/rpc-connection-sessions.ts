import "server-only";

import { gatewayQuery } from "./db";
import type { DeveloperApiStatus } from "./rpc-customers";

type Row = Record<string, unknown>;

export interface CreateConnectionSessionResult {
  status: DeveloperApiStatus;
  sessionId: string | null;
  /** The opaque connection URL token -- returned once, exactly like a credential's plaintext secret. */
  token: string | null;
  /** Set as an httpOnly cookie by the route that calls this; binds the session to this browser. */
  nonce: string | null;
  expiresAt: string | null;
}

export async function createConnectionSession(input: {
  credentialSecret: string;
  customerId: string;
  connectorId: string;
  returnUrl: string;
}): Promise<CreateConnectionSessionResult> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.create_connection_session($1, $2::uuid, $3, $4)`,
    [input.credentialSecret, input.customerId, input.connectorId, input.returnUrl],
  );
  const r = rows[0];
  return {
    status: r.ccs_status as string,
    sessionId: (r.ccs_session_id as string) ?? null,
    token: (r.ccs_token as string) ?? null,
    nonce: (r.ccs_nonce as string) ?? null,
    expiresAt: (r.ccs_expires_at as string) ?? null,
  };
}

export interface ResolvedConnectionSession {
  status: DeveloperApiStatus;
  sessionId: string | null;
  tenantId: string | null;
  applicationId: string | null;
  customerId: string | null;
  connectorId: string | null;
  nonceHash: string | null;
  returnUrl: string | null;
}

/** Called only by a provider-specific callback route, never by a backend credential. */
export async function resolveConnectionSession(token: string): Promise<ResolvedConnectionSession> {
  const rows = await gatewayQuery<Row>(`select * from gateway.resolve_connection_session($1)`, [token]);
  const r = rows[0];
  return {
    status: r.rcs_status as string,
    sessionId: (r.rcs_session_id as string) ?? null,
    tenantId: (r.rcs_tenant_id as string) ?? null,
    applicationId: (r.rcs_application_id as string) ?? null,
    customerId: (r.rcs_customer_id as string) ?? null,
    connectorId: (r.rcs_connector_id as string) ?? null,
    nonceHash: (r.rcs_nonce_hash as string) ?? null,
    returnUrl: (r.rcs_return_url as string) ?? null,
  };
}

export async function completeConnectionSession(
  token: string,
  connectionId: string,
): Promise<"ok" | "already_resolved_or_expired"> {
  const rows = await gatewayQuery<{ complete_connection_session: string }>(
    `select gateway.complete_connection_session($1, $2::uuid) as complete_connection_session`,
    [token, connectionId],
  );
  return rows[0].complete_connection_session as "ok" | "already_resolved_or_expired";
}

export async function failConnectionSession(
  token: string,
  status: "cancelled" | "denied" | "expired",
): Promise<"ok" | "already_resolved_or_expired"> {
  const rows = await gatewayQuery<{ fail_connection_session: string }>(
    `select gateway.fail_connection_session($1, $2) as fail_connection_session`,
    [token, status],
  );
  return rows[0].fail_connection_session as "ok" | "already_resolved_or_expired";
}

export interface ConnectionSessionStatus {
  status: DeveloperApiStatus;
  sessionStatus: "pending" | "completed" | "expired" | "cancelled" | "denied" | null;
  connectorId: string | null;
  connectionId: string | null;
  expiresAt: string | null;
}

export async function connectionSessionStatus(input: {
  credentialSecret: string;
  sessionId: string;
}): Promise<ConnectionSessionStatus> {
  const rows = await gatewayQuery<Row>(`select * from gateway.connection_session_status($1, $2::uuid)`, [
    input.credentialSecret,
    input.sessionId,
  ]);
  const r = rows[0];
  return {
    status: r.css_status as string,
    sessionStatus: (r.css_session_status as ConnectionSessionStatus["sessionStatus"]) ?? null,
    connectorId: (r.css_connector_id as string) ?? null,
    connectionId: (r.css_connection_id as string) ?? null,
    expiresAt: (r.css_expires_at as string) ?? null,
  };
}
