import "server-only";

import { gatewayQuery } from "./db";
import type { DeveloperApiStatus } from "./rpc-customers";
import type { Json } from "@/lib/supabase/database.types";
import type { Tables } from "@/lib/persistence/db-types";
import { policyRowToDomain } from "@/lib/persistence/mappers/policy";
import type { Policy } from "@/lib/domain";

type Row = Record<string, unknown>;

export interface BackendTaskInfo {
  status: DeveloperApiStatus;
  tenantId: string | null;
  intent: string | null;
  customerId: string | null;
}

/** Confirms a task belongs to this backend credential's own tenant AND application before anything else touches it. */
export async function getTaskForBackend(secret: string, taskId: string): Promise<BackendTaskInfo> {
  const rows = await gatewayQuery<Row>(`select * from gateway.get_task_for_backend($1, $2::uuid)`, [
    secret,
    taskId,
  ]);
  const r = rows[0];
  return {
    status: r.gtb_status as string,
    tenantId: (r.gtb_tenant_id as string) ?? null,
    intent: (r.gtb_intent as string) ?? null,
    customerId: (r.gtb_customer_id as string) ?? null,
  };
}

/** `pg` returns `timestamptz` columns as `Date` instances; the domain mapper's zod schema expects ISO strings. */
function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return (value as string) ?? null;
}

/**
 * Every active policy for this credential's tenant, mapped through the same
 * domain mapper the dashboard repository uses. Takes `tenantId` explicitly
 * (rather than re-deriving it from the row) because the underlying RPC does
 * not echo it back -- every row here is already scoped to this credential's
 * own tenant by the RPC itself, this is only used to satisfy the shared
 * `Policy` schema's required field.
 */
export async function listActivePoliciesForBackend(
  secret: string,
  tenantId: string,
): Promise<{ status: DeveloperApiStatus; policies: Policy[] }> {
  const rows = await gatewayQuery<Row>(`select * from gateway.list_active_policies_for_backend($1)`, [
    secret,
  ]);
  const status = (rows[0]?.lap_status as string) ?? "unknown";
  if (status !== "ok") return { status, policies: [] };
  const policies = rows
    .filter((r) => r.lap_id != null)
    .map((r) => {
      const asTableRow = {
        id: r.lap_id,
        tenant_id: tenantId,
        name: r.lap_name,
        description: r.lap_description,
        version: r.lap_version,
        status: r.lap_status_value,
        effect: r.lap_effect,
        conditions: r.lap_conditions,
        required_approval_role: r.lap_required_approval_role,
        required_approval_count: r.lap_required_approval_count,
        created_at: toIsoString(r.lap_created_at),
        activated_at: toIsoString(r.lap_activated_at),
        created_by: null,
        demo_key: null,
      } as unknown as Tables<"policies">;
      return policyRowToDomain(asTableRow);
    })
    .filter((p) => p.status === "active");
  return { status, policies };
}

export interface BackendPlanNode {
  nodeKey: string;
  sequenceNo: number;
  tool: string;
  resource: string | null;
  normalizedArguments: unknown;
  dependencies: string[];
  declaredOutputs: unknown;
  dataFlowRefs: unknown;
  maxInvocations: number | null;
  validationStatus: string;
  expectedEffect: string | null;
}

export async function getPlanNodesForBackend(
  secret: string,
  planId: string,
): Promise<{ status: DeveloperApiStatus; nodes: BackendPlanNode[] }> {
  const rows = await gatewayQuery<Row>(`select * from gateway.get_plan_nodes_for_backend($1, $2::uuid)`, [
    secret,
    planId,
  ]);
  const status = (rows[0]?.gpn_status as string) ?? "unknown";
  if (status !== "ok") return { status, nodes: [] };
  return {
    status,
    nodes: rows
      .filter((r) => r.gpn_node_key != null)
      .map((r) => ({
        nodeKey: r.gpn_node_key as string,
        sequenceNo: r.gpn_sequence_no as number,
        tool: r.gpn_tool as string,
        resource: (r.gpn_resource as string) ?? null,
        normalizedArguments: r.gpn_normalized_arguments,
        dependencies: (r.gpn_dependencies as string[]) ?? [],
        declaredOutputs: r.gpn_declared_outputs,
        dataFlowRefs: r.gpn_data_flow_refs,
        maxInvocations: (r.gpn_max_invocations as number) ?? null,
        validationStatus: r.gpn_validation_status as string,
        expectedEffect: (r.gpn_expected_effect as string) ?? null,
      })),
  };
}

export interface BackendCandidatePlanNodeInput {
  id: string;
  sequence: number;
  tool: string;
  arguments: unknown;
  resourceBinding: string | null;
  dependencies: string[];
  declaredOutputs: unknown;
  dataFlowRefs: unknown;
  maxInvocations: number | null;
  validationStatus: string;
  expectedSideEffect: string | null;
}

export interface CreateCandidatePlanForBackendResult {
  status: DeveloperApiStatus;
  planId: string | null;
  version: number | null;
  wasCreated: boolean;
}

export async function createCandidatePlanForBackend(input: {
  credentialSecret: string;
  taskId: string;
  nodes: BackendCandidatePlanNodeInput[];
  inputHash: string;
  idempotencyKey?: string | null;
}): Promise<CreateCandidatePlanForBackendResult> {
  const nodes = input.nodes.map((n) => ({
    id: n.id,
    sequence: n.sequence,
    tool: n.tool,
    arguments: n.arguments,
    resource_binding: n.resourceBinding,
    dependencies: n.dependencies,
    declared_outputs: n.declaredOutputs,
    data_flow_refs: n.dataFlowRefs,
    max_invocations: n.maxInvocations,
    validation_status: n.validationStatus,
    expected_effect: n.expectedSideEffect,
  }));
  const rows = await gatewayQuery<Row>(
    `select * from gateway.create_candidate_plan_for_backend($1, $2::uuid, $3::jsonb, $4, $5)`,
    [
      input.credentialSecret,
      input.taskId,
      JSON.stringify(nodes),
      input.inputHash,
      input.idempotencyKey ?? null,
    ],
  );
  const r = rows[0];
  return {
    status: r.ccp_status as string,
    planId: (r.ccp_plan_id as string) ?? null,
    version: (r.ccp_version as number) ?? null,
    wasCreated: Boolean(r.ccp_was_created),
  };
}

export interface ProposeTaskContractForBackendResult {
  status: DeveloperApiStatus;
  contractId: string | null;
  version: number | null;
  wasCreated: boolean;
}

export async function proposeTaskContractForBackend(input: {
  credentialSecret: string;
  taskId: string;
  planId: string;
  allowedActions: Json;
  forbiddenResources: string[];
  forbiddenOperations: string[];
  ephemeralLimits: Json;
  dataFlowBindings: Json;
  requiredApprovals: Json;
  requiredApprovalsSpec: Json;
  registryVersion: string;
  compilerVersion: string;
  inputHash: string;
  outputHash: string;
  verifierResult: Json;
  objectiveTrace: Json;
}): Promise<ProposeTaskContractForBackendResult> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.propose_task_contract_for_backend(
      $1, $2::uuid, $3::uuid, $4::jsonb, $5::text[], $6::text[], $7::jsonb, $8::jsonb,
      $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15::jsonb, $16::jsonb
    )`,
    [
      input.credentialSecret,
      input.taskId,
      input.planId,
      JSON.stringify(input.allowedActions),
      input.forbiddenResources,
      input.forbiddenOperations,
      JSON.stringify(input.ephemeralLimits),
      JSON.stringify(input.dataFlowBindings),
      JSON.stringify(input.requiredApprovals),
      JSON.stringify(input.requiredApprovalsSpec),
      input.registryVersion,
      input.compilerVersion,
      input.inputHash,
      input.outputHash,
      JSON.stringify(input.verifierResult),
      JSON.stringify(input.objectiveTrace),
    ],
  );
  const r = rows[0];
  return {
    status: r.ptc_status as string,
    contractId: (r.ptc_contract_id as string) ?? null,
    version: (r.ptc_version as number) ?? null,
    wasCreated: Boolean(r.ptc_was_created),
  };
}

export interface BackendContractInfo {
  status: DeveloperApiStatus;
  taskId: string | null;
  planId: string | null;
  contractStatus: string | null;
  tools: string[];
  requiredApprovalsCount: number;
  registryVersion: string | null;
  compilerVersion: string | null;
  inputHash: string | null;
  outputHash: string | null;
}

export async function getContractForBackend(
  secret: string,
  contractId: string,
): Promise<BackendContractInfo> {
  const rows = await gatewayQuery<Row>(`select * from gateway.get_contract_for_backend($1, $2::uuid)`, [
    secret,
    contractId,
  ]);
  const r = rows[0];
  return {
    status: r.gcb_status as string,
    taskId: (r.gcb_task_id as string) ?? null,
    planId: (r.gcb_plan_id as string) ?? null,
    contractStatus: (r.gcb_contract_status as string) ?? null,
    tools: (r.gcb_tools as string[]) ?? [],
    requiredApprovalsCount: (r.gcb_required_approvals_count as number) ?? 0,
    registryVersion: (r.gcb_registry_version as string) ?? null,
    compilerVersion: (r.gcb_compiler_version as string) ?? null,
    inputHash: (r.gcb_input_hash as string) ?? null,
    outputHash: (r.gcb_output_hash as string) ?? null,
  };
}

/**
 * Attempts automatic activation. Returns a plain status string
 * ('ok' | 'not_eligible' | 'not_found' | an auth failure) -- never throws
 * for the ordinary "not eligible yet" case, since that is an expected,
 * common outcome (most contracts require a human), not an error.
 */
export async function activateTaskContractForBackend(secret: string, contractId: string): Promise<string> {
  const rows = await gatewayQuery<{ activate_task_contract_for_backend: string }>(
    `select gateway.activate_task_contract_for_backend($1, $2::uuid) as activate_task_contract_for_backend`,
    [secret, contractId],
  );
  return rows[0].activate_task_contract_for_backend;
}
