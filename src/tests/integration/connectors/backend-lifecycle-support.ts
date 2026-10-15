import { createHash, randomBytes, randomUUID } from "node:crypto";

import { TENANT_A_ID, managementQuery } from "../support";

/**
 * Shared scaffolding for the four backend-credential, full-lifecycle
 * connector tests (stripe/slack/postgres/custom-api `*-lifecycle.test.ts`):
 * prepareTask() -> session -> tool manifest -> authorize -> execute,
 * against each connector's own in-memory fixture provider. Factored out of
 * the four test files (unlike the small `authorize`/`run` helpers every
 * `*-connector.test.ts` file already duplicates) because this boilerplate
 * -- an application, a backend credential, an agent with its own runtime
 * key, and the full task/plan/contract cleanup chain -- is an order of
 * magnitude larger and identical across all four, closely mirroring
 * `task-lifecycle-backend.test.ts`'s own local helpers of the same names.
 */

const BACKEND_SECRET_PREFIX = "authority_dk_";
const AGENT_SECRET_PREFIX = "authority_rk_";

/** Real seeded auth.users id (supabase/seed.sql) -- see gateway.actor_meets_role. */
export const ADMIN_A_USER_ID = "a0000000-0000-4000-8000-000000000002";

export interface BackendApplicationFixture {
  applicationId: string;
  backendSecret: string;
  cleanup: () => Promise<void>;
}

/** An application + its backend credential, the same shape `task-lifecycle-backend.test.ts` builds directly via SQL. */
export async function createApplicationFixture(
  suffix: string,
  slugPrefix: string,
): Promise<BackendApplicationFixture> {
  const applicationId = `cccc0000-0000-4000-8000-${suffix}0000`;
  const plaintext = `${BACKEND_SECRET_PREFIX}${randomBytes(32).toString("hex")}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  const keyPrefix = plaintext.slice(0, 21);

  await managementQuery(`
    insert into public.applications (id, tenant_id, name, slug)
    values ('${applicationId}', '${TENANT_A_ID}', 'Connector lifecycle test app', '${slugPrefix}-${suffix}');

    insert into public.developer_backend_credentials (tenant_id, application_id, key_prefix, key_hash)
    values ('${TENANT_A_ID}', '${applicationId}', '${keyPrefix}', '${hash}');
  `);

  return {
    applicationId,
    backendSecret: plaintext,
    cleanup: async () => {
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.developer_backend_credentials where application_id = '${applicationId}';
        delete from public.customers where application_id = '${applicationId}';
        delete from public.applications where id = '${applicationId}';
      `);
    },
  };
}

export interface AgentWithRuntimeKey {
  agentId: string;
  /** An `authority_rk_...` runtime key -- NOT the backend credential. `gateway.create_task_session`
   * only resolves a runtime key or an existing session token (see task-session-token.ts's own
   * `resolve_credential` branch), never a `developer_backend_credentials` secret. */
  agentSecret: string;
  cleanup: () => Promise<void>;
}

/** An agent plus its own runtime key, so this fixture can mint a task session the way a real agent would -- never the backend secret used for `prepareTask()`. */
export async function createAgentWithRuntimeKey(label: string): Promise<AgentWithRuntimeKey> {
  const agentId = randomUUID();
  const plaintext = `${AGENT_SECRET_PREFIX}${randomBytes(32).toString("hex")}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");

  await managementQuery(`
    insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status)
    values ('${agentId}', '${TENANT_A_ID}', '${label}', 'openai', 'gpt', 'x',
      (select id from public.principals where tenant_id = '${TENANT_A_ID}' and kind = 'human' and user_id is null order by created_at limit 1), 'active');

    insert into public.agent_credentials (tenant_id, agent_id, key_prefix, key_hash, status)
    values ('${TENANT_A_ID}', '${agentId}', '${plaintext.slice(0, 21)}', '${hash}', 'active');
  `);

  return {
    agentId,
    agentSecret: plaintext,
    cleanup: async () => {
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.agent_auth_events where agent_id = '${agentId}';
        delete from public.agent_credentials where agent_id = '${agentId}';
        delete from public.agents where id = '${agentId}';
      `);
    },
  };
}

/**
 * Grants a customer use of an organization-owned connection --
 * `create_connector_connection` always creates `owner_kind = 'organization'`
 * connections (see 20261003000003_connection_ownership.sql), so every
 * customer-bound task in these tests needs an explicit delegation row
 * before `createCustomerTask`'s own `connection_usable_by_customer` check
 * will pass. Same direct-insert pattern `customer-connections.test.ts`
 * already uses (there is no backend-credential-callable RPC for this --
 * `grant_connection_delegation` is dashboard-only, auth.uid()-gated).
 */
export async function delegateConnection(connectionId: string, customerId: string): Promise<void> {
  await managementQuery(`
    insert into public.connection_delegations (tenant_id, connection_id, customer_id)
    values ('${TENANT_A_ID}', '${connectionId}', '${customerId}');
  `);
}

function planNode(
  taskId: string,
  tool: string,
  args: Record<string, unknown>,
  options?: { resourceBinding?: string; expectedSideEffect?: string },
) {
  return {
    schemaVersion: 1,
    taskId,
    nodes: [
      {
        id: "n1",
        sequence: 0,
        tool,
        arguments: args,
        ...(options?.resourceBinding ? { resourceBinding: options.resourceBinding } : {}),
        dependencies: [],
        declaredOutputs: [],
        dataFlowRefs: [],
        expectedSideEffect: options?.expectedSideEffect ?? "read",
        maxInvocations: 1,
      },
    ],
  };
}

export const planFor = planNode;

/** Every row a prepared, activated, authorized-and-executed task can have left behind, in FK-safe order. */
export async function cleanupTask(taskId: string): Promise<void> {
  await managementQuery(`
    set local role postgres;
    select set_config('authority.allow_demo_purge', 'on', true);
    delete from public.jev_risk_evaluations where task_id = '${taskId}';
    delete from public.jev_necessity_evaluations where task_id = '${taskId}';
    delete from public.jev_plan_completeness_evaluations where task_id = '${taskId}';
    delete from public.connector_execution_receipts where task_id = '${taskId}';
    delete from public.connector_reservations where task_id = '${taskId}';
    delete from public.task_connector_bindings where task_id = '${taskId}';
    delete from public.capability_reservations where task_id = '${taskId}';
    delete from public.runtime_approval_decisions where request_id in (select id from public.runtime_approval_requests where task_id = '${taskId}');
    delete from public.capability_consumptions where capability_id in (select id from public.capability_tokens where task_id = '${taskId}');
    delete from public.task_sessions where task_id = '${taskId}';
    delete from public.capability_tokens where task_id = '${taskId}';
    delete from public.runtime_approval_requests where task_id = '${taskId}';
    delete from public.final_decisions where task_id = '${taskId}';
    delete from public.semantic_evaluations where task_id = '${taskId}';
    delete from public.semantic_shadow_evaluations where task_id = '${taskId}';
    delete from public.execution_events where task_id = '${taskId}';
    delete from public.authorization_decisions where task_id = '${taskId}';
    delete from public.capabilities where task_id = '${taskId}';
    delete from public.tool_requests where task_id = '${taskId}';
    delete from public.contract_compilations where task_id = '${taskId}';
    delete from public.task_authority_contracts where task_id = '${taskId}';
    delete from public.plan_nodes where plan_id in (select id from public.plans where task_id = '${taskId}');
    delete from public.plans where task_id = '${taskId}';
    delete from public.tasks where id = '${taskId}';
  `);
}

export { TENANT_A_ID };
