import { createHash, randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getSupabaseEnv } from "@/lib/env";
import { authorizeToolCall } from "@/lib/runtime/authorize-tool-call";
import type { Database } from "@/lib/supabase/database.types";

import { TENANT_A_ID, managementQuery } from "../support";

/**
 * The one property pgTAP structurally cannot verify: real concurrent
 * requests against the last unit of a contract's budget. pgTAP suites run
 * as a single sequential SQL batch inside one transaction (see
 * scripts/db-test.mjs) — every "budget exhaustion" assertion there is
 * still one statement after another, never two genuinely simultaneous
 * connections. This test fires two real HTTP-adjacent RPC calls at once
 * from two independent connections against a contract with exactly one
 * invocation of budget remaining, and asserts the atomic reservation inside
 * authorize_tool_call() — the per-task advisory lock plus the row it
 * updates in the same transaction — lets exactly one of them through.
 *
 * Fixture rows are inserted directly via the Management API (bypassing
 * every RPC, the same way the pgTAP suites' own fixtures do) rather than
 * signing in and running the full propose/activate pipeline: contract rows
 * only become immutable on UPDATE or DELETE, never on INSERT (see
 * authz.enforce_contract_immutable()'s trigger registration), so an INSERT
 * that already sets contract_status = 'active' is legitimate setup, not a
 * bypass of anything this test is trying to verify.
 */
describe("authorize_tool_call concurrency", () => {
  const suffix = randomBytes(4).toString("hex");
  const agentId = `cc000000-0000-4000-8000-0000000000${suffix.slice(0, 2)}`;
  const taskId = `cc000000-0000-4000-8000-0000000001${suffix.slice(0, 2)}`;
  const contractId = `cc000000-0000-4000-8000-0000000002${suffix.slice(0, 2)}`;
  const credentialId = `cc000000-0000-4000-8000-0000000003${suffix.slice(0, 2)}`;
  const secret = `authority_rk_${randomBytes(32).toString("hex")}`;
  const keyPrefix = secret.slice(0, 21);
  const keyHash = createHash("sha256").update(secret).digest("hex");

  beforeAll(async () => {
    await managementQuery(`
      insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status)
      values ('${agentId}', '${TENANT_A_ID}', 'concurrency-fixture-${suffix}', 'openai', 'gpt', 'x',
        (select id from public.principals where tenant_id = '${TENANT_A_ID}' and kind = 'human' limit 1), 'active');

      insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status)
      values ('${taskId}', '${TENANT_A_ID}', '${agentId}',
        (select id from public.principals where tenant_id = '${TENANT_A_ID}' and kind = 'human' limit 1),
        'Concurrency fixture task', 'contract_issued');

      insert into public.task_authority_contracts (
        id, tenant_id, task_id, version, spec_version, allowed_actions, forbidden_resources, forbidden_operations,
        ephemeral_limits, contract_status, registry_version, compiler_version, input_hash, output_hash,
        data_flow_bindings, required_approvals, activated_at, expires_at, required_approvals_spec, demo_key
      ) values (
        '${contractId}', '${TENANT_A_ID}', '${taskId}', 1, 'v1',
        '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}'::jsonb,
        '{}', '{}',
        '{"schemaVersion":1,"maxToolInvocations":1,"expiresInSeconds":3600}'::jsonb,
        'active', 'rv1', 'cv1', repeat('9', 64), repeat('8', 64),
        '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb,
        now(), now() + interval '1 hour', '{"schemaVersion":1,"items":[]}'::jsonb,
        'test:concurrency:${suffix}'
      );

      insert into public.agent_credentials (id, tenant_id, agent_id, key_prefix, key_hash, status)
      values ('${credentialId}', '${TENANT_A_ID}', '${agentId}', '${keyPrefix}', '${keyHash}', 'active');
    `);
  }, 20_000);

  afterAll(async () => {
    await managementQuery(`
      set local role postgres;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.execution_events where task_id = '${taskId}';
      delete from public.authorization_decisions where task_id = '${taskId}';
      delete from public.capabilities where task_id = '${taskId}';
      delete from public.tool_requests where task_id = '${taskId}';
      delete from public.task_authority_contracts where task_id = '${taskId}';
      delete from public.tasks where id = '${taskId}';
      delete from public.agent_auth_events where agent_id = '${agentId}';
      delete from public.agent_credentials where id = '${credentialId}';
      delete from public.agents where id = '${agentId}';
      select set_config('authority.allow_demo_purge', 'off', true);
    `);
  }, 20_000);

  it("lets exactly one of two concurrent calls consume the last unit of budget", async () => {
    const { url, publishableKey } = getSupabaseEnv();
    const anon = createClient<Database>(url, publishableKey, { auth: { persistSession: false } });

    const call = (idempotencyKey: string) =>
      authorizeToolCall(anon, {
        credentialSecret: secret,
        taskId,
        tool: "github.get_issue",
        operation: "get_issue",
        idempotencyKey,
        currentRegistryVersion: "rv1",
        currentCompilerVersion: "cv1",
      });

    const [first, second] = await Promise.all([
      call(`concurrency-${suffix}-a`),
      call(`concurrency-${suffix}-b`),
    ]);

    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(["allow", "deny"]);

    const denied = first.outcome === "deny" ? first : second;
    expect(denied.reasonCodes).toContain("INVOCATION_LIMIT_REACHED");

    const capabilities = (await managementQuery(
      `select consumed_uses, max_invocations from public.capabilities where task_id = '${taskId}';`,
    )) as Array<{ consumed_uses: number; max_invocations: number }>;

    expect(capabilities).toHaveLength(1);
    expect(capabilities[0].consumed_uses).toBe(1);
    expect(capabilities[0].consumed_uses).toBeLessThanOrEqual(capabilities[0].max_invocations);
  });
});
