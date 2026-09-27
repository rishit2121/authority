import "server-only";

import { gatewayQuery } from "@/lib/gateway/db";

type Row = Record<string, unknown>;

/** Typed wrappers over the server-only `gateway.vl_*` functions. Sandbox functions refuse any non-sandbox tenant. */

export async function createSandbox(input: {
  ownerTenantId: string | null;
  actorUserId: string | null;
  ttlMinutes: number;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.vl_create_sandbox($1::uuid, $2::uuid, $3::int) as id`,
    [input.ownerTenantId, input.actorUserId, input.ttlMinutes],
  );
  return rows[0].id as string;
}

export async function seedSandbox(sandboxId: string, spec: unknown): Promise<SeededSandbox> {
  const rows = await gatewayQuery<Row>(`select gateway.vl_seed_sandbox($1::uuid, $2::jsonb) as r`, [
    sandboxId,
    JSON.stringify(spec),
  ]);
  return rows[0].r as SeededSandbox;
}

export interface SeededSandbox {
  taskId: string;
  contractId: string;
  principalId: string;
  agents: Record<string, string>;
  installationRowId: string | null;
  installationGhId: number | string | null;
  repositories: Record<string, string>;
}

export async function applyFault(
  sandboxId: string,
  fault: string,
  params: Record<string, unknown> = {},
): Promise<void> {
  await gatewayQuery(`select gateway.vl_fault($1::uuid, $2, $3::jsonb)`, [
    sandboxId,
    fault,
    JSON.stringify(params),
  ]);
}

export interface SandboxEvidence {
  requests: Array<{
    tool_request_id: string;
    tool: string;
    idempotency_key: string;
    deterministic_outcome: string | null;
    final_outcome: string | null;
    narrowed: boolean | null;
    semantic_mode: string | null;
    semantic_policy: string | null;
    degraded: boolean | null;
    degraded_reason: string | null;
    composition_reasons: string[] | null;
    reason_items: Array<{ code: string }> | null;
    semantic_state: string | null;
    semantic_risk: string | null;
    semantic_provider: string | null;
    semantic_indicators: string[] | null;
    semantic_latency_ms: number | null;
    capability_id: string | null;
    capability_status: string | null;
    uses: number | null;
    max_uses: number | null;
    approval_request_id: string | null;
  }>;
  reservations: Array<{ tool: string; status: string; mode: string; reason: string | null }>;
  receipts: Array<{ tool: string; category: string; mode: string; reason: string | null }>;
  approvals: Array<{ tool: string; status: string; stale_reason: string | null; required: number }>;
}

export async function sandboxEvidence(sandboxId: string): Promise<SandboxEvidence> {
  const rows = await gatewayQuery<Row>(`select gateway.vl_evidence($1::uuid) as e`, [sandboxId]);
  return rows[0].e as SandboxEvidence;
}

export async function destroySandbox(sandboxId: string): Promise<void> {
  await gatewayQuery(`select gateway.vl_destroy_sandbox($1::uuid)`, [sandboxId]);
}

export async function sweepValidation(limit = 25): Promise<{ sandboxes: number; campaigns: number }> {
  const rows = await gatewayQuery<Row>(`select * from gateway.vl_sweep($1::int)`, [limit]);
  return { sandboxes: Number(rows[0]?.sw_sandboxes ?? 0), campaigns: Number(rows[0]?.sw_campaigns ?? 0) };
}

// --- records -------------------------------------------------------------------------------------------------------

export async function registerScenario(input: {
  tenantId: string;
  key: string;
  version: number;
  source: string;
  definition: unknown;
  hash: string;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.vl_register_scenario($1::uuid, $2, $3::int, $4, $5::jsonb, $6) as id`,
    [input.tenantId, input.key, input.version, input.source, JSON.stringify(input.definition), input.hash],
  );
  return rows[0].id as string;
}

export async function campaignControl(
  tenantId: string,
  campaignId: string,
): Promise<{ status: string; cancel: boolean } | null> {
  const rows = await gatewayQuery<Row>(`select * from gateway.vl_campaign_control($1::uuid, $2::uuid)`, [
    tenantId,
    campaignId,
  ]);
  return rows[0] ? { status: rows[0].cc_status as string, cancel: Boolean(rows[0].cc_cancel) } : null;
}

export async function setCampaign(input: {
  tenantId: string;
  campaignId: string;
  status?: string;
  progress?: unknown;
  summary?: unknown;
}): Promise<void> {
  await gatewayQuery(`select gateway.vl_set_campaign($1::uuid, $2::uuid, $3, $4::jsonb, $5::jsonb)`, [
    input.tenantId,
    input.campaignId,
    input.status ?? null,
    input.progress === undefined ? null : JSON.stringify(input.progress),
    input.summary === undefined ? null : JSON.stringify(input.summary),
  ]);
}

export async function recordRun(
  tenantId: string,
  campaignId: string,
  run: Record<string, unknown>,
): Promise<string> {
  const rows = await gatewayQuery<Row>(`select gateway.vl_record_run($1::uuid, $2::uuid, $3::jsonb) as id`, [
    tenantId,
    campaignId,
    JSON.stringify(run),
  ]);
  return rows[0].id as string;
}

export async function recordSteps(tenantId: string, runId: string, steps: unknown[]): Promise<void> {
  if (steps.length === 0) return;
  await gatewayQuery(`select gateway.vl_record_steps($1::uuid, $2::uuid, $3::jsonb)`, [
    tenantId,
    runId,
    JSON.stringify(steps),
  ]);
}

export async function recordFindings(
  tenantId: string,
  campaignId: string,
  runId: string,
  findings: unknown[],
): Promise<void> {
  if (findings.length === 0) return;
  await gatewayQuery(`select gateway.vl_record_findings($1::uuid, $2::uuid, $3::uuid, $4::jsonb)`, [
    tenantId,
    campaignId,
    runId,
    JSON.stringify(findings),
  ]);
}

export async function registerRegression(input: {
  tenantId: string;
  remediationId: string;
  key: string;
  scenarioVersionId: string;
  description: string;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.vl_register_regression($1::uuid, $2::uuid, $3, $4::uuid, $5) as id`,
    [input.tenantId, input.remediationId, input.key, input.scenarioVersionId, input.description],
  );
  return rows[0].id as string;
}

export async function recordVerification(input: {
  tenantId: string;
  remediationId: string;
  beforeRunId: string | null;
  afterRunId: string | null;
  status: "verified" | "failed";
  verification: unknown;
}): Promise<void> {
  await gatewayQuery(
    `select gateway.vl_record_verification($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::jsonb)`,
    [
      input.tenantId,
      input.remediationId,
      input.beforeRunId,
      input.afterRunId,
      input.status,
      JSON.stringify(input.verification),
    ],
  );
}

export async function updateRegressionResult(
  tenantId: string,
  regressionId: string,
  runId: string,
  status: string,
): Promise<void> {
  await gatewayQuery(`select gateway.vl_update_regression_result($1::uuid, $2::uuid, $3::uuid, $4)`, [
    tenantId,
    regressionId,
    runId,
    status,
  ]);
}

export async function createEnvironment(input: {
  tenantId: string;
  userId: string;
  name: string;
  description: string | null;
  spec: unknown;
  ttlHours: number;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.vl_create_environment($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::int) as id`,
    [input.tenantId, input.userId, input.name, input.description, JSON.stringify(input.spec), input.ttlHours],
  );
  return rows[0].id as string;
}

export async function startCampaignRecord(input: {
  tenantId: string;
  userId: string;
  environmentId: string;
  name: string;
  packKey: string | null;
  seed: number;
  config: unknown;
  total: number;
}): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.vl_start_campaign($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::bigint, $7::jsonb, $8::int) as id`,
    [
      input.tenantId,
      input.userId,
      input.environmentId,
      input.name,
      input.packKey,
      input.seed,
      JSON.stringify(input.config),
      input.total,
    ],
  );
  return rows[0].id as string;
}

export async function cancelCampaignRecord(
  tenantId: string,
  userId: string,
  campaignId: string,
): Promise<string> {
  const rows = await gatewayQuery<Row>(
    `select gateway.vl_cancel_campaign($1::uuid, $2::uuid, $3::uuid) as s`,
    [tenantId, userId, campaignId],
  );
  return rows[0].s as string;
}

export async function loadStoredScenarios(
  tenantId: string,
  keys: string[],
): Promise<
  Array<{
    key: string;
    version: number;
    definition: unknown;
    source: string;
    id: string;
    regressionId: string | null;
  }>
> {
  if (keys.length === 0) return [];
  const rows = await gatewayQuery<Row>(`select * from gateway.vl_get_scenarios($1::uuid, $2::text[])`, [
    tenantId,
    keys,
  ]);
  return rows.map((r) => ({
    key: r.gs_key as string,
    version: r.gs_version as number,
    definition: r.gs_definition,
    source: r.gs_source as string,
    id: r.gs_id as string,
    regressionId: (r.gs_regression_id as string) ?? null,
  }));
}
