import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { TENANT_A_ID, managementQuery } from "./support";

/**
 * Fixture for real-database gateway tests: an agent, an executable task, an
 * active contract and a runtime credential, inserted directly via the
 * Management API (contract rows are only immutable on UPDATE/DELETE, so an
 * INSERT that is already `active` is legitimate setup). Everything is removed
 * again in `cleanup()`, in foreign-key order, under the demo-purge escape hatch.
 */
export interface GatewayFixture {
  tenantId: string;
  agentId: string;
  taskId: string;
  contractId: string;
  credentialId: string;
  secret: string;
  cleanup: () => Promise<void>;
}

/**
 * The registry and compiler versions the running application currently
 * supports, read from source (the registry module is server-only and cannot be
 * imported into a test runner). Contracts built for HTTP tests must use them,
 * or the runtime correctly denies them as UNSUPPORTED_CONTRACT_VERSION.
 */
export function currentVersions(): { registryVersion: string; compilerVersion: string } {
  const root = process.cwd();
  const registry = /registryVersion:\s*"([^"]+)"/.exec(
    readFileSync(path.join(root, "src/lib/registry/fixtures/github-demo.ts"), "utf8"),
  );
  const compiler = /COMPILER_VERSION\s*=\s*"([^"]+)"/.exec(
    readFileSync(path.join(root, "src/lib/authorization/contract-compiler.ts"), "utf8"),
  );
  if (!registry || !compiler) throw new Error("could not read current registry/compiler versions");
  return { registryVersion: registry[1], compilerVersion: compiler[1] };
}

export async function createGatewayFixture(options: {
  label: string;
  actions?: string;
  maxToolInvocations?: number;
  forbiddenResources?: string;
  /** Use the app's real registry/compiler versions (for tests that go through the HTTP routes). */
  useCurrentVersions?: boolean;
  /** Bind the task to a mock-installation repository (creating the installation if needed). Default: none. */
  githubRepo?: string;
}): Promise<GatewayFixture> {
  const suffix = randomBytes(2).toString("hex");
  const id = (n: number) => `dd000000-0000-4000-8000-0000000${n}${suffix}`;
  const agentId = id(0);
  const taskId = id(2);
  const contractId = id(3);
  const credentialId = id(4);
  const versions = options.useCurrentVersions
    ? currentVersions()
    : { registryVersion: "rv1", compilerVersion: "cv1" };
  const secret = `authority_rk_${randomBytes(32).toString("hex")}`;
  const hash = createHash("sha256").update(secret).digest("hex");
  const actions =
    options.actions ??
    '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[{"key":"issue_number","equals":"1"}]}]}';

  await managementQuery(`
    insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status)
    values ('${agentId}', '${TENANT_A_ID}', '${options.label}-${suffix}', 'openai', 'gpt', 'x',
      (select id from public.principals where tenant_id = '${TENANT_A_ID}' and kind = 'human' limit 1), 'active');

    insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status)
    values ('${taskId}', '${TENANT_A_ID}', '${agentId}',
      (select id from public.principals where tenant_id = '${TENANT_A_ID}' and kind = 'human' limit 1),
      'Read issue 1 in payments-api', 'contract_issued');

    insert into public.task_authority_contracts (
      id, tenant_id, task_id, version, spec_version, allowed_actions, forbidden_resources, forbidden_operations,
      ephemeral_limits, contract_status, registry_version, compiler_version, input_hash, output_hash,
      data_flow_bindings, required_approvals, activated_at, expires_at, required_approvals_spec, demo_key
    ) values (
      '${contractId}', '${TENANT_A_ID}', '${taskId}', 1, 'v1',
      '${actions}'::jsonb, '${options.forbiddenResources ?? "{}"}', '{}',
      '{"schemaVersion":1,"maxToolInvocations":${options.maxToolInvocations ?? 50},"expiresInSeconds":3600}'::jsonb,
      'active', '${versions.registryVersion}', '${versions.compilerVersion}', repeat('9', 64), repeat('8', 64),
      '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb,
      now(), now() + interval '1 hour', '{"schemaVersion":1,"items":[]}'::jsonb, 'test:${options.label}:${suffix}'
    );

    insert into public.agent_credentials (id, tenant_id, agent_id, key_prefix, key_hash, status)
    values ('${credentialId}', '${TENANT_A_ID}', '${agentId}', '${secret.slice(0, 21)}', '${hash}', 'active');
  `);

  if (options.githubRepo) await bindTaskToMockRepo(taskId, options.githubRepo);

  return {
    tenantId: TENANT_A_ID,
    agentId,
    taskId,
    contractId,
    credentialId,
    secret,
    cleanup: async () => {
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.github_execution_receipts where task_id = '${taskId}';
        delete from public.capability_reservations where task_id = '${taskId}';
        delete from public.task_repository_bindings where task_id = '${taskId}';
        delete from public.runtime_approval_decisions where request_id in (select id from public.runtime_approval_requests where task_id = '${taskId}');
        delete from public.capability_consumptions where capability_id in (select id from public.capability_tokens where task_id = '${taskId}');
        delete from public.capability_tokens where task_id = '${taskId}';
        delete from public.runtime_approval_requests where task_id = '${taskId}';
        delete from public.final_decisions where task_id = '${taskId}';
        delete from public.semantic_evaluations where task_id = '${taskId}';
        delete from public.semantic_shadow_evaluations where task_id = '${taskId}';
        delete from public.execution_events where task_id = '${taskId}';
        delete from public.authorization_decisions where task_id = '${taskId}';
        delete from public.capabilities where task_id = '${taskId}';
        delete from public.tool_requests where task_id = '${taskId}';
        delete from public.task_authority_contracts where task_id = '${taskId}';
        delete from public.tasks where id = '${taskId}';
        delete from public.agent_auth_events where agent_id = '${agentId}';
        delete from public.agent_credentials where agent_id = '${agentId}';
        delete from public.agents where id = '${agentId}';
      `);
    },
  };
}

/** Sets this tenant's semantic settings directly (bypassing the RPC, which needs a signed-in user). */
export async function setSemanticSettings(s: {
  mode: "off" | "shadow" | "enforce";
  provider?: string;
  model?: string;
  timeoutMs?: number;
  requiredClasses?: string[];
  ttlSeconds?: number;
}): Promise<void> {
  const provider = s.provider ?? "mock";
  const model = s.model ?? "mock-heuristic";
  const approved = s.mode === "enforce" ? `now()` : "null";
  const approvedProvider = s.mode === "enforce" ? `'${provider}'` : "null";
  const approvedModel = s.mode === "enforce" ? `'${model}'` : "null";
  const classes = `'{${(s.requiredClasses ?? []).join(",")}}'::text[]`;
  await managementQuery(`
    insert into public.semantic_settings (tenant_id, mode, provider, model, timeout_ms, semantic_required_classes,
      capability_ttl_seconds, enforcement_approved_at, enforcement_approved_provider, enforcement_approved_model)
    values ('${TENANT_A_ID}', '${s.mode}', '${provider}', '${model}', ${s.timeoutMs ?? 500}, ${classes},
      ${s.ttlSeconds ?? 60}, ${approved}, ${approvedProvider}, ${approvedModel})
    on conflict (tenant_id) do update set mode = excluded.mode, provider = excluded.provider, model = excluded.model,
      timeout_ms = excluded.timeout_ms, semantic_required_classes = excluded.semantic_required_classes,
      capability_ttl_seconds = excluded.capability_ttl_seconds, enforcement_approved_at = excluded.enforcement_approved_at,
      enforcement_approved_provider = excluded.enforcement_approved_provider,
      enforcement_approved_model = excluded.enforcement_approved_model;
  `);
}

export async function resetSemanticSettings(): Promise<void> {
  await managementQuery(`
    set local role postgres;
    select set_config('authority.allow_demo_purge', 'on', true);
    delete from public.semantic_settings_audit where tenant_id = '${TENANT_A_ID}';
    delete from public.semantic_settings where tenant_id = '${TENANT_A_ID}';
  `);
}

/**
 * A `mock`-mode GitHub installation for tenant A with a few repositories. Idempotent and
 * non-destructive, so several fixtures can share it. Mirrors the mock GitHub's seed data.
 */
export const MOCK_REPOS: Record<string, number> = {
  "acme/widgets": 1001,
  "acme/fault-write-timeout": 1002,
  "acme/fault-write-timeout-applied": 1003,
  "acme/fault-write-502": 1004,
  "acme/fault-write-403": 1005,
};

export async function ensureMockInstallation(): Promise<{ installationRowId: string }> {
  const rows = (await managementQuery(`
    insert into public.github_installations (tenant_id, github_installation_id, mode, account_login, account_type, github_account_id,
      repository_selection, granted_permissions, status)
    select '${TENANT_A_ID}', 9001, 'mock', 'acme', 'Organization', 5001, 'selected',
      '{"contents":"write","issues":"read","metadata":"read","pull_requests":"write"}'::jsonb, 'active'
    where not exists (select 1 from public.github_installations where tenant_id = '${TENANT_A_ID}' and status <> 'disconnected')
    on conflict (github_installation_id) do nothing;
    select id from public.github_installations where tenant_id = '${TENANT_A_ID}' and github_installation_id = 9001 and status = 'active';
  `)) as Array<{ id: string }>;
  if (!rows[0])
    throw new Error("mock installation is not active for tenant A (a different installation is connected)");
  const row = rows[0].id;
  const values = Object.entries(MOCK_REPOS)
    .map(([full, id]) => {
      const [owner, name] = full.split("/");
      return `('${TENANT_A_ID}', '${row}', ${id}, '${owner}', '${name}', 'main', true, false, true, true, now())`;
    })
    .join(",");
  await managementQuery(`
    insert into public.github_repositories (tenant_id, installation_row_id, github_repository_id, owner, name, default_branch, is_private,
      archived, present, allowed, allowed_at)
    values ${values}
    on conflict (installation_row_id, github_repository_id) do update set present = true, allowed = true, archived = false,
      allowed_at = coalesce(public.github_repositories.allowed_at, now());
  `);
  return { installationRowId: row };
}

export async function bindTaskToMockRepo(taskId: string, fullName: string): Promise<void> {
  await ensureMockInstallation();
  const [owner, name] = fullName.split("/");
  await managementQuery(`
    insert into public.task_repository_bindings (tenant_id, task_id, repository_id, bound_by_principal_id)
    select '${TENANT_A_ID}', '${taskId}', r.id,
      (select id from public.principals where tenant_id = '${TENANT_A_ID}' and kind = 'human' limit 1)
    from public.github_repositories r where r.tenant_id = '${TENANT_A_ID}' and r.owner = '${owner}' and r.name = '${name}';
  `);
}

/** Removes every GitHub row for tenant A (installation flow tests start from a clean slate). */
export async function purgeGithubState(): Promise<void> {
  await managementQuery(`
    set local role postgres;
    select set_config('authority.allow_demo_purge', 'on', true);
    delete from public.github_execution_receipts where tenant_id = '${TENANT_A_ID}';
    delete from public.capability_reservations where tenant_id = '${TENANT_A_ID}';
    delete from public.task_repository_bindings where tenant_id = '${TENANT_A_ID}';
    delete from public.github_repositories where tenant_id = '${TENANT_A_ID}';
    delete from public.github_install_states where tenant_id = '${TENANT_A_ID}';
    delete from public.github_installations where tenant_id = '${TENANT_A_ID}';
    delete from public.github_webhook_deliveries;
  `);
}
