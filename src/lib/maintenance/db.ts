import "server-only";

import { gatewayQuery } from "@/lib/gateway/db";

type Row = Record<string, unknown>;

export interface DueWebhook {
  deliveryId: string;
  event: string;
  action: string | null;
  installationId: string;
  removedRepositoryIds: number[];
  attempts: number;
}

export async function enqueueWebhookRetry(input: {
  deliveryId: string;
  event: string;
  action: string | null;
  installationId: string;
  removedRepositoryIds: number[];
}): Promise<void> {
  await gatewayQuery(`select gateway.webhook_retry_enqueue($1, $2, $3, $4::bigint, $5::bigint[])`, [
    input.deliveryId,
    input.event,
    input.action,
    input.installationId,
    input.removedRepositoryIds,
  ]);
}

export async function dueWebhookRetries(limit: number): Promise<DueWebhook[]> {
  const rows = await gatewayQuery<Row>(`select * from gateway.webhook_retry_due($1::int)`, [limit]);
  return rows.map((r) => ({
    deliveryId: r.r_delivery_id as string,
    event: r.r_event as string,
    action: (r.r_action as string | null) ?? null,
    installationId: String(r.r_installation),
    removedRepositoryIds: ((r.r_removed as Array<string | number>) ?? []).map(Number),
    attempts: Number(r.r_attempts ?? 0),
  }));
}

export async function markWebhookRetry(
  deliveryId: string,
  ok: boolean,
  errorCategory: string,
): Promise<void> {
  await gatewayQuery(`select gateway.webhook_retry_mark($1, $2::boolean, $3)`, [
    deliveryId,
    ok,
    errorCategory,
  ]);
}

export interface DueInstallation {
  rowId: string;
  tenantId: string;
  githubInstallationId: string;
}

export async function dueInstallations(ageSeconds: number, limit: number): Promise<DueInstallation[]> {
  const rows = await gatewayQuery<Row>(`select * from gateway.github_installations_due($1::int, $2::int)`, [
    ageSeconds,
    limit,
  ]);
  return rows.map((r) => ({
    rowId: r.i_row_id as string,
    tenantId: r.i_tenant_id as string,
    githubInstallationId: String(r.i_github_installation_id),
  }));
}

export async function retentionPurge(limit: number): Promise<{
  campaigns: number;
  webhookDeliveries: number;
  webhookRetries: number;
  environments: number;
}> {
  const rows = await gatewayQuery<Row>(`select * from gateway.retention_purge($1::int)`, [limit]);
  const r = rows[0] ?? {};
  return {
    campaigns: Number(r.rp_campaigns ?? 0),
    webhookDeliveries: Number(r.rp_webhook_deliveries ?? 0),
    webhookRetries: Number(r.rp_webhook_retries ?? 0),
    environments: Number(r.rp_environments ?? 0),
  };
}

export async function schemaVersion(): Promise<string | null> {
  const rows = await gatewayQuery<Row>(`select gateway.schema_version() as v`);
  return (rows[0]?.v as string | undefined) ?? null;
}
