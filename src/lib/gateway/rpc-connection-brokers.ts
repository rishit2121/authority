import "server-only";

import { gatewayQuery } from "./db";
import type { DeveloperApiStatus } from "./rpc-customers";

type Row = Record<string, unknown>;

export interface RegisterBrokerConnectionResult {
  status: DeveloperApiStatus;
  connectionId: string | null;
}

export async function registerBrokerConnection(input: {
  credentialSecret: string;
  customerId: string;
  connectorId: string;
  brokerId: string;
  brokerConnectionRef: string;
  verifiedAccountRef: string;
}): Promise<RegisterBrokerConnectionResult> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.register_broker_connection($1, $2::uuid, $3, $4::uuid, $5, $6)`,
    [
      input.credentialSecret,
      input.customerId,
      input.connectorId,
      input.brokerId,
      input.brokerConnectionRef,
      input.verifiedAccountRef,
    ],
  );
  const r = rows[0];
  return { status: r.rbc2_status as string, connectionId: (r.rbc2_connection_id as string) ?? null };
}

export interface ResolvedConnectionBroker {
  status: DeveloperApiStatus;
  url: string | null;
  /** Server-only. Never log, return to a client, or include in a receipt. */
  secret: string | null;
  brokerConnectionRef: string | null;
}

/** Server-side execution code only -- see gateway.resolve_connection_broker's own module comment. */
export async function resolveConnectionBroker(connectionId: string): Promise<ResolvedConnectionBroker> {
  const rows = await gatewayQuery<Row>(`select * from gateway.resolve_connection_broker($1::uuid)`, [
    connectionId,
  ]);
  const r = rows[0];
  return {
    status: r.rcb_status as string,
    url: (r.rcb_url as string) ?? null,
    secret: (r.rcb_secret as string) ?? null,
    brokerConnectionRef: (r.rcb_broker_connection_ref as string) ?? null,
  };
}
