-- Part 8: adversarial validation ("Validation Lab") schema.
--
-- Safety model, stated once:
--   * A campaign never touches real data. Every run executes inside an isolated SANDBOX TENANT: a `tenants`
--     row flagged `validation_sandbox` (development environment, mandatory expiry, no memberships, so no user can
--     see or act in it). Sandbox functions refuse any tenant that is not a live sandbox.
--   * External effects are mocks only (an in-memory GitHub, an in-memory effect ledger). Sandbox installations are
--     `mock` mode, which the connector already refuses to execute against a live reservation.
--   * Campaign records (environments, runs, steps, findings, remediations) live in the customer's tenant, are
--     written only by server-only gateway functions, and are readable by tenant members through RLS. They hold
--     sanitized request summaries and synthetic scenario evidence, never real credentials or raw arguments.
--   * Remediations are proposals. Nothing here modifies an active contract, policy or registry.

-- ---------------------------------------------------------------------------
-- Sandbox tenants
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column validation_sandbox boolean not null default false,
  add column validation_owner_tenant_id uuid references public.tenants (id) on delete cascade,
  add column validation_expires_at timestamptz,
  add constraint tenants_sandbox_requires_expiry check (not validation_sandbox or validation_expires_at is not null),
  add constraint tenants_sandbox_is_development check (not validation_sandbox or environment = 'development');
create index tenants_sandbox_expiry_idx on public.tenants (validation_expires_at) where validation_sandbox;

create sequence gateway.vl_installation_seq start 900000000000;
create sequence gateway.vl_slug_seq;

-- ---------------------------------------------------------------------------
-- Campaign records (customer tenant)
-- ---------------------------------------------------------------------------
create table public.validation_environments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 1000),
  -- Limits and dataset: {"schemaVersion":1,"limits":{...},"github":{"repos":[...]},"seedData":"synthetic-v1"}
  spec        jsonb not null check (authz.has_allowed_schema_version(spec, array[1]) and pg_column_size(spec) <= 16384),
  status      text not null default 'ready' check (status in ('ready', 'expired', 'archived')),
  expires_at  timestamptz not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id)
);

create table public.validation_scenario_versions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  scenario_key text not null check (scenario_key ~ '^[a-z0-9][a-z0-9._-]{1,79}$'),
  version     integer not null check (version > 0),
  source      text not null check (source in ('builtin', 'custom', 'regression')),
  definition  jsonb not null check (pg_column_size(definition) <= 65536),
  definition_hash text not null check (definition_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  -- Immutable and reproducible: the same key+version can only ever hold one definition.
  unique (tenant_id, scenario_key, version, definition_hash)
);
create trigger validation_scenario_versions_immutable
  before update or delete on public.validation_scenario_versions
  for each row execute function authz.forbid_update_delete();

create table public.validation_campaigns (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  environment_id uuid not null,
  name        text not null check (char_length(btrim(name)) between 1 and 160),
  pack_key    text check (pack_key is null or pack_key ~ '^[a-z0-9][a-z0-9._-]{1,79}$'),
  seed        bigint not null,
  config      jsonb not null check (pg_column_size(config) <= 32768),
  status      text not null default 'queued' check (status in ('queued', 'running', 'completed', 'cancelled', 'failed', 'expired')),
  cancel_requested boolean not null default false,
  progress    jsonb not null default '{"total":0,"done":0}'::jsonb,
  summary     jsonb,
  synthetic   boolean not null default true check (synthetic),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz,
  unique (id, tenant_id),
  foreign key (environment_id, tenant_id) references public.validation_environments (id, tenant_id)
);
create index validation_campaigns_tenant_idx on public.validation_campaigns (tenant_id, created_at desc);

create table public.validation_runs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  campaign_id uuid not null,
  scenario_version_id uuid not null,
  scenario_key text not null,
  scenario_version integer not null,
  variant     text not null default 'baseline' check (char_length(variant) between 1 and 80),
  repetition  integer not null default 1 check (repetition > 0),
  seed        bigint not null,
  status      text not null default 'running' check (status in ('running', 'completed', 'cancelled', 'error')),
  verdict     text check (verdict in ('pass', 'fail', 'error')),
  regression_id uuid,
  sandbox_tenant_id uuid,   -- deliberately no FK: the sandbox is destroyed when the run ends
  metrics     jsonb,
  effects     jsonb,
  error_category text check (error_category is null or error_category ~ '^[a-z_]{1,40}$'),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  unique (id, tenant_id),
  foreign key (campaign_id, tenant_id) references public.validation_campaigns (id, tenant_id) on delete cascade,
  foreign key (scenario_version_id, tenant_id) references public.validation_scenario_versions (id, tenant_id)
);
create index validation_runs_campaign_idx on public.validation_runs (campaign_id, started_at);
create index validation_runs_scenario_idx on public.validation_runs (tenant_id, scenario_key, started_at desc);

create table public.validation_steps (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  run_id      uuid not null,
  seq         integer not null check (seq >= 0),
  step_key    text not null check (char_length(step_key) between 1 and 80),
  kind        text not null check (kind in ('baseline', 'attack', 'fault', 'control')),
  action      text not null check (char_length(action) between 1 and 60),
  label       text not null check (char_length(label) between 1 and 300),
  request     jsonb,     -- sanitized: tool, operation, resource, argument audit (keys/types/hashes)
  expected    jsonb,
  actual      jsonb,
  verdict     text not null check (verdict in ('pass', 'fail', 'skipped', 'error')),
  control     text check (control is null or control ~ '^[a-z_]{1,40}$'),
  latency_ms  integer check (latency_ms is null or latency_ms >= 0),
  evidence    jsonb check (evidence is null or pg_column_size(evidence) <= 16384),
  occurred_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (run_id, seq),
  foreign key (run_id, tenant_id) references public.validation_runs (id, tenant_id) on delete cascade
);
create trigger validation_steps_append_only
  before update or delete on public.validation_steps
  for each row execute function authz.forbid_update_delete();

create table public.validation_findings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  campaign_id uuid not null,
  run_id      uuid not null,
  step_id     uuid,
  scenario_key text not null,
  severity    text not null check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  category    text not null check (char_length(category) between 1 and 60),
  cause       text not null check (char_length(cause) between 1 and 60),
  title       text not null check (char_length(title) between 1 and 200),
  summary     text not null check (char_length(summary) <= 2000),
  evidence    jsonb not null default '{}'::jsonb check (pg_column_size(evidence) <= 16384),
  status      text not null default 'open' check (status in ('open', 'remediation_proposed', 'accepted', 'rejected', 'fixed', 'wont_fix')),
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (campaign_id, tenant_id) references public.validation_campaigns (id, tenant_id) on delete cascade,
  foreign key (run_id, tenant_id) references public.validation_runs (id, tenant_id) on delete cascade
);
create index validation_findings_tenant_idx on public.validation_findings (tenant_id, created_at desc);

create table public.validation_remediations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  finding_id  uuid not null,
  kind        text not null check (char_length(kind) between 1 and 60),
  -- Structured proposal; `broadensAuthority` is asserted false by the server before storage.
  proposal    jsonb not null check (pg_column_size(proposal) <= 16384 and (proposal ->> 'broadensAuthority') = 'false'),
  status      text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected', 'verified', 'failed_verification')),
  decided_by  uuid references auth.users (id) on delete set null,
  decided_at  timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  regression_scenario_version_id uuid,
  before_run_id uuid,
  after_run_id uuid,
  verification jsonb,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (finding_id, tenant_id) references public.validation_findings (id, tenant_id) on delete cascade,
  constraint remediation_decision_consistent check ((status in ('proposed')) = (decided_at is null))
);

create table public.validation_regressions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  scenario_key text not null,
  scenario_version_id uuid not null,
  origin_remediation_id uuid,
  description text not null check (char_length(description) <= 500),
  last_run_id uuid,
  last_status text check (last_status in ('pass', 'fail', 'error')),
  last_run_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  unique (tenant_id, scenario_key),
  foreign key (scenario_version_id, tenant_id) references public.validation_scenario_versions (id, tenant_id)
);

alter table public.validation_runs
  add constraint validation_runs_regression_fk foreign key (regression_id, tenant_id) references public.validation_regressions (id, tenant_id);

do $$
declare t text;
begin
  foreach t in array array['validation_environments', 'validation_scenario_versions', 'validation_campaigns', 'validation_runs',
                           'validation_steps', 'validation_findings', 'validation_remediations', 'validation_regressions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (authz.is_member_of(tenant_id))', t || '_select_within_tenant', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Sandbox lifecycle (server-only). Every function refuses a tenant that is not a LIVE sandbox.
-- ---------------------------------------------------------------------------
create or replace function gateway.vl_assert_sandbox(p_tenant uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not exists (select 1 from public.tenants t
                 where t.id = p_tenant and t.validation_sandbox and t.validation_expires_at > now() and t.environment = 'development') then
    raise exception 'not a live validation sandbox' using errcode = '42501';
  end if;
end;
$fn$;
revoke all on function gateway.vl_assert_sandbox(uuid) from public;
grant execute on function gateway.vl_assert_sandbox(uuid) to authority_gateway;

-- p_owner_tenant may be null only for an ephemeral CI sandbox (no owning customer tenant).
create or replace function gateway.vl_create_sandbox(p_owner_tenant uuid, p_actor_user uuid, p_ttl_minutes integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid := gen_random_uuid();
  v_user uuid := p_actor_user;
begin
  if p_ttl_minutes is null or p_ttl_minutes not between 1 and 240 then
    raise exception 'sandbox lifetime must be 1-240 minutes' using errcode = '22023';
  end if;
  if p_owner_tenant is not null then
    if p_actor_user is null or not gateway.actor_meets_role(p_owner_tenant, p_actor_user, 'developer') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if exists (select 1 from public.tenants t where t.id = p_owner_tenant and t.validation_sandbox) then
      raise exception 'a sandbox cannot own a sandbox' using errcode = '42501';
    end if;
    -- Bound how many sandboxes one tenant can hold at once.
    if (select count(*) from public.tenants t where t.validation_owner_tenant_id = p_owner_tenant and t.validation_expires_at > now()) >= 12 then
      raise exception 'too many live sandboxes' using errcode = '53400';
    end if;
  end if;
  if v_user is null then
    select u.id into v_user from auth.users u order by u.created_at limit 1;
    if v_user is null then raise exception 'no user exists to own a sandbox; seed the database first' using errcode = 'P0002'; end if;
  end if;
  insert into public.tenants (id, name, slug, environment, created_by, validation_sandbox, validation_owner_tenant_id, validation_expires_at)
  values (v_id, 'validation sandbox', 'vl-' || nextval('gateway.vl_slug_seq')::text || '-' || substr(v_id::text, 1, 8), 'development', v_user,
          true, p_owner_tenant, now() + make_interval(mins => p_ttl_minutes));
  return v_id;
end;
$fn$;
revoke all on function gateway.vl_create_sandbox(uuid, uuid, integer) from public;
grant execute on function gateway.vl_create_sandbox(uuid, uuid, integer) to authority_gateway;

-- Seeds the synthetic world: principal, agents + runtime keys, one task with an ACTIVE contract, semantic/approval
-- settings, and (optionally) a MOCK GitHub installation with repositories bound to the task.
create or replace function gateway.vl_seed_sandbox(p_sandbox uuid, p_spec jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_principal uuid := gen_random_uuid();
  v_task uuid := gen_random_uuid();
  v_contract uuid := gen_random_uuid();
  v_agents jsonb := '{}'::jsonb;
  v_agent uuid;
  a jsonb;
  c jsonb := p_spec -> 'contract';
  s jsonb := coalesce(p_spec -> 'settings', '{}'::jsonb);
  v_mode public.semantic_mode := coalesce(s ->> 'mode', 'off')::public.semantic_mode;
  v_provider text := coalesce(s ->> 'provider', 'mock');
  v_model text := coalesce(s ->> 'model', 'mock-heuristic');
  v_inst uuid;
  v_inst_gh bigint;
  r jsonb;
  v_repo uuid;
  v_bound uuid;
  v_repos jsonb := '{}'::jsonb;
  v_i integer := 0;
  v_primary text := coalesce(p_spec ->> 'primaryAgent', 'primary');
begin
  perform gateway.vl_assert_sandbox(p_sandbox);
  if c is null or jsonb_typeof(p_spec -> 'agents') <> 'array' or jsonb_array_length(p_spec -> 'agents') not between 1 and 5 then
    raise exception 'sandbox spec needs a contract and 1-5 agents' using errcode = '22023';
  end if;
  if pg_column_size(p_spec) > 65536 then raise exception 'sandbox spec too large' using errcode = '22023'; end if;

  insert into public.principals (id, tenant_id, kind, display_name) values (v_principal, p_sandbox, 'human', 'Validation task owner');

  for a in select e.value from jsonb_array_elements(p_spec -> 'agents') e loop
    v_agent := gen_random_uuid();
    insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status)
    values (v_agent, p_sandbox, 'vl-' || (a ->> 'key'), 'synthetic', 'synthetic', 'validation', v_principal, 'active');
    insert into public.agent_credentials (tenant_id, agent_id, key_prefix, key_hash, status)
    values (p_sandbox, v_agent, a ->> 'keyPrefix', a ->> 'keyHash', 'active');
    v_agents := v_agents || jsonb_build_object(a ->> 'key', v_agent);
  end loop;
  if not (v_agents ? v_primary) then raise exception 'primary agent missing' using errcode = '22023'; end if;

  insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status)
  values (v_task, p_sandbox, (v_agents ->> v_primary)::uuid, v_principal, left(coalesce(p_spec ->> 'intent', 'validation task'), 4000), 'contract_issued');

  insert into public.task_authority_contracts (
    id, tenant_id, task_id, version, spec_version, allowed_actions, forbidden_resources, forbidden_operations,
    ephemeral_limits, contract_status, registry_version, compiler_version, input_hash, output_hash,
    data_flow_bindings, required_approvals, activated_at, expires_at, required_approvals_spec, demo_key
  ) values (
    v_contract, p_sandbox, v_task, 1, coalesce(c ->> 'specVersion', 'v1'), c -> 'allowedActions',
    array(select jsonb_array_elements_text(coalesce(c -> 'forbiddenResources', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(c -> 'forbiddenOperations', '[]'::jsonb))),
    c -> 'ephemeralLimits', 'active', c ->> 'registryVersion', c ->> 'compilerVersion',
    coalesce(c ->> 'inputHash', repeat('9', 64)), coalesce(c ->> 'outputHash', repeat('8', 64)),
    jsonb_build_object('schemaVersion', 1, 'refs', coalesce(c -> 'dataFlowBindings', '[]'::jsonb)),
    '{"schemaVersion":1,"items":[]}'::jsonb, now(), now() + interval '2 hours', '{"schemaVersion":1,"items":[]}'::jsonb,
    'validation:' || v_contract::text
  );

  insert into public.semantic_settings (
    tenant_id, mode, provider, model, timeout_ms, semantic_required_classes, capability_ttl_seconds,
    runtime_approval_classes, enforcement_approved_at, enforcement_approved_provider, enforcement_approved_model
  ) values (
    p_sandbox, v_mode, v_provider, v_model, coalesce((s ->> 'timeoutMs')::integer, 500),
    array(select jsonb_array_elements_text(coalesce(s -> 'requiredClasses', '[]'::jsonb))),
    coalesce((s ->> 'capabilityTtlSeconds')::integer, 60),
    array(select jsonb_array_elements_text(coalesce(s -> 'approvalClasses', '[]'::jsonb))),
    case when v_mode = 'enforce' then now() end, case when v_mode = 'enforce' then v_provider end,
    case when v_mode = 'enforce' then v_model end
  );

  if p_spec ? 'github' then
    v_inst := gen_random_uuid();
    v_inst_gh := nextval('gateway.vl_installation_seq');
    insert into public.github_installations (id, tenant_id, github_installation_id, mode, account_login, account_type, github_account_id,
      repository_selection, granted_permissions, status)
    values (v_inst, p_sandbox, v_inst_gh, 'mock', 'validation-org', 'Organization', 1, 'selected',
      '{"contents":"write","issues":"read","metadata":"read","pull_requests":"write"}'::jsonb, 'active');
    for r in select e.value from jsonb_array_elements(p_spec -> 'github' -> 'repos') e loop
      v_i := v_i + 1;
      v_repo := gen_random_uuid();
      insert into public.github_repositories (id, tenant_id, installation_row_id, github_repository_id, owner, name, default_branch, is_private,
        allowed, allowed_at)
      values (v_repo, p_sandbox, v_inst, v_i, r ->> 'owner', r ->> 'name', coalesce(r ->> 'defaultBranch', 'main'), true,
        coalesce((r ->> 'allowed')::boolean, true), case when coalesce((r ->> 'allowed')::boolean, true) then now() end);
      v_repos := v_repos || jsonb_build_object(lower((r ->> 'owner') || '/' || (r ->> 'name')), v_repo);
      if lower((r ->> 'owner') || '/' || (r ->> 'name')) = lower(p_spec -> 'github' ->> 'boundRepo') then v_bound := v_repo; end if;
    end loop;
    if v_bound is not null then
      insert into public.task_repository_bindings (tenant_id, task_id, repository_id, bound_by_principal_id)
      values (p_sandbox, v_task, v_bound, v_principal);
    end if;
  end if;

  return jsonb_build_object('taskId', v_task, 'contractId', v_contract, 'principalId', v_principal, 'agents', v_agents,
    'installationRowId', v_inst, 'repositories', v_repos);
end;
$fn$;
revoke all on function gateway.vl_seed_sandbox(uuid, jsonb) from public;
grant execute on function gateway.vl_seed_sandbox(uuid, jsonb) to authority_gateway;

-- Mid-run faults an adversary or an outage could cause. Only the state changes real administrators / infrastructure make.
create or replace function gateway.vl_fault(p_sandbox uuid, p_fault text, p_params jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_agent uuid;
  v_approver uuid;
  v_req uuid;
  v_n integer := 0;
begin
  perform gateway.vl_assert_sandbox(p_sandbox);
  if p_fault = 'revoke_contract' then
    update public.task_authority_contracts set contract_status = 'revoked', revoked_at = now(),
      revoked_by_principal_id = (select p.id from public.principals p where p.tenant_id = p_sandbox limit 1), revocation_reason = 'validation fault'
      where tenant_id = p_sandbox and contract_status = 'active';
  elsif p_fault = 'revoke_agent' then
    update public.agents set status = 'revoked' where tenant_id = p_sandbox and name = 'vl-' || (p_params ->> 'agent');
  elsif p_fault = 'revoke_key' then
    select a.id into v_agent from public.agents a where a.tenant_id = p_sandbox and a.name = 'vl-' || (p_params ->> 'agent');
    update public.agent_credentials set status = 'revoked', revoked_at = now(), revocation_reason = 'validation fault'
      where tenant_id = p_sandbox and agent_id = v_agent and status = 'active';
  elsif p_fault = 'terminate_task' then
    update public.tasks set status = 'terminated', terminated_at = now() where tenant_id = p_sandbox;
  elsif p_fault = 'set_approval_classes' then
    update public.semantic_settings set runtime_approval_classes = array(select jsonb_array_elements_text(p_params -> 'classes')) where tenant_id = p_sandbox;
  elsif p_fault = 'revoke_installation_permission' then
    update public.github_installations set status = 'permission_drift', health_reasons = array['PERMISSION_EXTRA:administration'] where tenant_id = p_sandbox;
  elsif p_fault in ('approve_request', 'reject_request') then
    select p.id into v_approver from public.principals p where p.tenant_id = p_sandbox and p.display_name = 'Validation approver';
    if v_approver is null then
      v_approver := gen_random_uuid();
      insert into public.principals (id, tenant_id, kind, display_name) values (v_approver, p_sandbox, 'human', 'Validation approver');
    end if;
    select ar.id into v_req from public.runtime_approval_requests ar
      where ar.tenant_id = p_sandbox and ar.status = 'pending' order by ar.created_at desc limit 1;
    if v_req is null then return jsonb_build_object('applied', false); end if;
    insert into public.runtime_approval_decisions (tenant_id, request_id, approver_principal_id, decision, note)
      values (p_sandbox, v_req, v_approver, case when p_fault = 'approve_request' then 'approve' else 'reject' end, 'validation fault');
    update public.runtime_approval_requests set status = case when p_fault = 'approve_request' then 'approved' else 'rejected' end, resolved_at = now()
      where id = v_req;
  elsif p_fault = 'expire_approvals' then
    -- Only sandbox rows may be back-dated (see the guard change below).
    perform set_config('authority.validation_fault', 'on', true);
    update public.runtime_approval_requests set created_at = now() - interval '3 hours', expires_at = now() - interval '2 hours'
      where tenant_id = p_sandbox and status in ('pending', 'approved');
    get diagnostics v_n = row_count;
  else
    raise exception 'unknown fault' using errcode = '22023';
  end if;
  return jsonb_build_object('applied', true, 'rows', v_n);
end;
$fn$;
revoke all on function gateway.vl_fault(uuid, text, jsonb) from public;
grant execute on function gateway.vl_fault(uuid, text, jsonb) to authority_gateway;

-- Sandbox rows only: lets the validation fault above back-date an approval request (the binding stays immutable otherwise).
create or replace function gateway.enforce_approval_request_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('authority.allow_demo_purge', true) = 'on' then return old; end if;
    raise exception 'runtime approval requests cannot be deleted' using errcode = '23514';
  end if;
  if current_setting('authority.validation_fault', true) = 'on'
     and exists (select 1 from public.tenants t where t.id = new.tenant_id and t.validation_sandbox) then
    return new;
  end if;
  if (new.id, new.tenant_id, new.task_id, new.agent_id, new.tool_request_id, new.authorization_decision_id,
      new.final_decision_id, new.contract_id, new.contract_version, new.tool, new.operation, new.resource,
      new.arguments_hash, new.request_hash, new.risk_class, new.trigger_kind, new.evidence, new.context_hash,
      new.required_approvals, new.created_at, new.expires_at)
     is distinct from
     (old.id, old.tenant_id, old.task_id, old.agent_id, old.tool_request_id, old.authorization_decision_id,
      old.final_decision_id, old.contract_id, old.contract_version, old.tool, old.operation, old.resource,
      old.arguments_hash, old.request_hash, old.risk_class, old.trigger_kind, old.evidence, old.context_hash,
      old.required_approvals, old.created_at, old.expires_at) then
    raise exception 'an approval request''s binding is immutable' using errcode = '23514';
  end if;
  if old.status <> new.status and not (
       (old.status = 'pending' and new.status in ('approved', 'rejected', 'expired', 'stale'))
    or (old.status = 'approved' and new.status in ('consumed', 'stale', 'expired'))) then
    raise exception 'approval request cannot move from % to %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end;
$$;

-- What actually happened inside the sandbox, as the database recorded it (decisions, semantic evidence, capabilities,
-- reservations, receipts, approvals). The engine correlates this with its own step log.
create or replace function gateway.vl_evidence(p_sandbox uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform gateway.vl_assert_sandbox(p_sandbox);
  return jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at) from (
        select tr.id as tool_request_id, tr.tool, tr.idempotency_key, ad.outcome::text as deterministic_outcome, fd.final_outcome::text as final_outcome,
               fd.narrowed, fd.semantic_mode::text as semantic_mode, fd.semantic_policy, fd.degraded, fd.degraded_reason, fd.composition_reasons,
               ad.reason_codes -> 'items' as reason_items, se.state::text as semantic_state, se.risk_level::text as semantic_risk,
               se.provider as semantic_provider, se.indicators as semantic_indicators, se.latency_ms as semantic_latency_ms,
               ct.id as capability_id, ct.status as capability_status, ct.uses, ct.reserved_uses, ct.max_uses, ct.approval_request_id, tr.requested_at as created_at
        from public.tool_requests tr
        left join public.authorization_decisions ad on ad.tool_request_id = tr.id
        left join public.final_decisions fd on fd.authorization_decision_id = ad.id
        left join public.semantic_evaluations se on se.authorization_decision_id = ad.id
        left join public.capability_tokens ct on ct.authorization_decision_id = ad.id
        where tr.tenant_id = p_sandbox) x), '[]'::jsonb),
    'reservations', coalesce((select jsonb_agg(jsonb_build_object('tool', r.tool, 'status', r.status, 'mode', r.execution_mode, 'reason', r.reason_code)
                                                order by r.created_at) from public.capability_reservations r where r.tenant_id = p_sandbox), '[]'::jsonb),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('tool', g.tool, 'category', g.result_category, 'mode', g.execution_mode, 'reason', g.reason_code)
                                             order by g.created_at) from public.github_execution_receipts g where g.tenant_id = p_sandbox), '[]'::jsonb),
    'approvals', coalesce((select jsonb_agg(jsonb_build_object('tool', a.tool, 'status', a.status, 'stale_reason', a.stale_reason, 'required', a.required_approvals)
                                              order by a.created_at) from public.runtime_approval_requests a where a.tenant_id = p_sandbox), '[]'::jsonb)
  );
end;
$fn$;
revoke all on function gateway.vl_evidence(uuid) from public;
grant execute on function gateway.vl_evidence(uuid) to authority_gateway;

-- Destroys a sandbox and everything in it. Refuses anything that is not a sandbox tenant.
create or replace function gateway.vl_destroy_sandbox(p_sandbox uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not exists (select 1 from public.tenants t where t.id = p_sandbox and t.validation_sandbox) then
    raise exception 'refusing to destroy a tenant that is not a validation sandbox' using errcode = '42501';
  end if;
  perform set_config('authority.allow_demo_purge', 'on', true);
  delete from public.tenants where id = p_sandbox and validation_sandbox;
  perform set_config('authority.allow_demo_purge', 'off', true);
  return true;
end;
$fn$;
revoke all on function gateway.vl_destroy_sandbox(uuid) from public;
grant execute on function gateway.vl_destroy_sandbox(uuid) to authority_gateway;

-- Expired sandboxes (crashed runs, abandoned CI) and campaigns stuck 'running'.
create or replace function gateway.vl_sweep(p_limit integer)
returns table (sw_sandboxes integer, sw_campaigns integer)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_s integer := 0;
  v_c integer := 0;
begin
  for v_id in select t.id from public.tenants t where t.validation_sandbox and t.validation_expires_at < now()
              order by t.validation_expires_at limit greatest(least(coalesce(p_limit, 25), 200), 1) loop
    perform gateway.vl_destroy_sandbox(v_id);
    v_s := v_s + 1;
  end loop;
  update public.validation_campaigns set status = 'failed', finished_at = now(),
      summary = coalesce(summary, '{}'::jsonb) || '{"error":"campaign exceeded its time limit"}'::jsonb
    where status in ('queued', 'running') and created_at < now() - interval '30 minutes';
  get diagnostics v_c = row_count;
  update public.validation_environments set status = 'expired' where status = 'ready' and expires_at < now();
  return query select v_s, v_c;
end;
$fn$;
revoke all on function gateway.vl_sweep(integer) from public;
grant execute on function gateway.vl_sweep(integer) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Records (customer tenant). All actor-verified; engine writes progress with p_actor NULL only for an existing campaign.
-- ---------------------------------------------------------------------------
create or replace function gateway.vl_create_environment(p_tenant uuid, p_user uuid, p_name text, p_description text, p_spec jsonb, p_ttl_hours integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_id uuid;
begin
  if not gateway.actor_meets_role(p_tenant, p_user, 'developer') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_ttl_hours is null or p_ttl_hours not between 1 and 720 then raise exception 'lifetime must be 1-720 hours' using errcode = '22023'; end if;
  if (select count(*) from public.validation_environments e where e.tenant_id = p_tenant and e.status = 'ready') >= 25 then
    raise exception 'too many environments' using errcode = '53400';
  end if;
  insert into public.validation_environments (tenant_id, name, description, spec, expires_at, created_by)
  values (p_tenant, btrim(p_name), p_description, p_spec, now() + make_interval(hours => p_ttl_hours), p_user) returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function gateway.vl_create_environment(uuid, uuid, text, text, jsonb, integer) from public;
grant execute on function gateway.vl_create_environment(uuid, uuid, text, text, jsonb, integer) to authority_gateway;

create or replace function gateway.vl_register_scenario(p_tenant uuid, p_key text, p_version integer, p_source text, p_definition jsonb, p_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_id uuid;
begin
  select id into v_id from public.validation_scenario_versions
    where tenant_id = p_tenant and scenario_key = p_key and version = p_version and definition_hash = p_hash;
  if v_id is not null then return v_id; end if;
  if exists (select 1 from public.validation_scenario_versions where tenant_id = p_tenant and scenario_key = p_key and version = p_version) then
    raise exception 'scenario version already exists with a different definition' using errcode = '23505';
  end if;
  insert into public.validation_scenario_versions (tenant_id, scenario_key, version, source, definition, definition_hash)
  values (p_tenant, p_key, p_version, p_source, p_definition, p_hash) returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function gateway.vl_register_scenario(uuid, text, integer, text, jsonb, text) from public;
grant execute on function gateway.vl_register_scenario(uuid, text, integer, text, jsonb, text) to authority_gateway;

create or replace function gateway.vl_start_campaign(p_tenant uuid, p_user uuid, p_environment uuid, p_name text, p_pack text, p_seed bigint, p_config jsonb, p_total integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_id uuid;
begin
  if not gateway.actor_meets_role(p_tenant, p_user, 'developer') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.validation_environments e where e.id = p_environment and e.tenant_id = p_tenant and e.status = 'ready' and e.expires_at > now()) then
    raise exception 'environment is not ready' using errcode = '55000';
  end if;
  if (select count(*) from public.validation_campaigns c where c.tenant_id = p_tenant and c.status in ('queued', 'running')) >= 3 then
    raise exception 'too many active campaigns' using errcode = '53400';
  end if;
  insert into public.validation_campaigns (tenant_id, environment_id, name, pack_key, seed, config, progress, created_by)
  values (p_tenant, p_environment, btrim(p_name), p_pack, p_seed, p_config, jsonb_build_object('total', p_total, 'done', 0), p_user) returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function gateway.vl_start_campaign(uuid, uuid, uuid, text, text, bigint, jsonb, integer) from public;
grant execute on function gateway.vl_start_campaign(uuid, uuid, uuid, text, text, bigint, jsonb, integer) to authority_gateway;

create or replace function gateway.vl_campaign_control(p_tenant uuid, p_campaign uuid)
returns table (cc_status text, cc_cancel boolean)
language sql
stable
security definer
set search_path = ''
as $$ select c.status, c.cancel_requested from public.validation_campaigns c where c.id = p_campaign and c.tenant_id = p_tenant; $$;
revoke all on function gateway.vl_campaign_control(uuid, uuid) from public;
grant execute on function gateway.vl_campaign_control(uuid, uuid) to authority_gateway;

create or replace function gateway.vl_cancel_campaign(p_tenant uuid, p_user uuid, p_campaign uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_status text;
begin
  if not gateway.actor_meets_role(p_tenant, p_user, 'developer') then return 'forbidden'; end if;
  select status into v_status from public.validation_campaigns where id = p_campaign and tenant_id = p_tenant for update;
  if v_status is null then return 'not_found'; end if;
  if v_status not in ('queued', 'running') then return 'not_active'; end if;
  update public.validation_campaigns set cancel_requested = true where id = p_campaign;
  return 'ok';
end;
$fn$;
revoke all on function gateway.vl_cancel_campaign(uuid, uuid, uuid) from public;
grant execute on function gateway.vl_cancel_campaign(uuid, uuid, uuid) to authority_gateway;

create or replace function gateway.vl_set_campaign(p_tenant uuid, p_campaign uuid, p_status text, p_progress jsonb, p_summary jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.validation_campaigns set
      status = coalesce(p_status, status), progress = coalesce(p_progress, progress), summary = coalesce(p_summary, summary),
      started_at = case when p_status = 'running' and started_at is null then now() else started_at end,
      finished_at = case when p_status in ('completed', 'cancelled', 'failed') then now() else finished_at end
    where id = p_campaign and tenant_id = p_tenant and status in ('queued', 'running');
end;
$fn$;
revoke all on function gateway.vl_set_campaign(uuid, uuid, text, jsonb, jsonb) from public;
grant execute on function gateway.vl_set_campaign(uuid, uuid, text, jsonb, jsonb) to authority_gateway;

create or replace function gateway.vl_record_run(p_tenant uuid, p_campaign uuid, p_run jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_id uuid := coalesce((p_run ->> 'id')::uuid, gen_random_uuid());
begin
  insert into public.validation_runs (id, tenant_id, campaign_id, scenario_version_id, scenario_key, scenario_version, variant, repetition, seed,
      status, verdict, regression_id, sandbox_tenant_id, metrics, effects, error_category, finished_at)
  values (v_id, p_tenant, p_campaign, (p_run ->> 'scenarioVersionId')::uuid, p_run ->> 'scenarioKey', (p_run ->> 'scenarioVersion')::integer,
      coalesce(p_run ->> 'variant', 'baseline'), coalesce((p_run ->> 'repetition')::integer, 1), (p_run ->> 'seed')::bigint,
      coalesce(p_run ->> 'status', 'running'), p_run ->> 'verdict', (p_run ->> 'regressionId')::uuid, (p_run ->> 'sandboxTenantId')::uuid,
      p_run -> 'metrics', p_run -> 'effects', p_run ->> 'errorCategory',
      case when coalesce(p_run ->> 'status', 'running') <> 'running' then now() end)
  on conflict (id) do update set status = excluded.status, verdict = excluded.verdict, metrics = excluded.metrics, effects = excluded.effects,
      error_category = excluded.error_category, sandbox_tenant_id = excluded.sandbox_tenant_id, finished_at = excluded.finished_at;
  return v_id;
end;
$fn$;
revoke all on function gateway.vl_record_run(uuid, uuid, jsonb) from public;
grant execute on function gateway.vl_record_run(uuid, uuid, jsonb) to authority_gateway;

create or replace function gateway.vl_record_steps(p_tenant uuid, p_run uuid, p_steps jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_n integer;
begin
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) > 200 then raise exception 'too many steps' using errcode = '22023'; end if;
  insert into public.validation_steps (tenant_id, run_id, seq, step_key, kind, action, label, request, expected, actual, verdict, control, latency_ms, evidence, occurred_at)
  select p_tenant, p_run, (s ->> 'seq')::integer, s ->> 'stepKey', s ->> 'kind', s ->> 'action', left(s ->> 'label', 300), s -> 'request', s -> 'expected',
         s -> 'actual', s ->> 'verdict', s ->> 'control', (s ->> 'latencyMs')::integer, s -> 'evidence', coalesce((s ->> 'occurredAt')::timestamptz, now())
  from jsonb_array_elements(p_steps) s
  on conflict (run_id, seq) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;
revoke all on function gateway.vl_record_steps(uuid, uuid, jsonb) from public;
grant execute on function gateway.vl_record_steps(uuid, uuid, jsonb) to authority_gateway;

-- Findings with their remediation proposals, in one call. Refuses any proposal that broadens authority.
create or replace function gateway.vl_record_findings(p_tenant uuid, p_campaign uuid, p_run uuid, p_findings jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  f jsonb;
  rm jsonb;
  v_id uuid;
  v_step uuid;
  v_n integer := 0;
begin
  if jsonb_typeof(p_findings) <> 'array' or jsonb_array_length(p_findings) > 100 then raise exception 'too many findings' using errcode = '22023'; end if;
  for f in select e.value from jsonb_array_elements(p_findings) e loop
    select id into v_step from public.validation_steps where run_id = p_run and tenant_id = p_tenant and seq = (f ->> 'stepSeq')::integer;
    insert into public.validation_findings (tenant_id, campaign_id, run_id, step_id, scenario_key, severity, category, cause, title, summary, evidence, status)
    values (p_tenant, p_campaign, p_run, v_step, f ->> 'scenarioKey', f ->> 'severity', f ->> 'category', f ->> 'cause', left(f ->> 'title', 200),
            left(f ->> 'summary', 2000), coalesce(f -> 'evidence', '{}'::jsonb),
            case when jsonb_array_length(coalesce(f -> 'remediations', '[]'::jsonb)) > 0 then 'remediation_proposed' else 'open' end)
    returning id into v_id;
    for rm in select e.value from jsonb_array_elements(coalesce(f -> 'remediations', '[]'::jsonb)) e loop
      insert into public.validation_remediations (tenant_id, finding_id, kind, proposal) values (p_tenant, v_id, rm ->> 'kind', rm);
    end loop;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;
revoke all on function gateway.vl_record_findings(uuid, uuid, uuid, jsonb) from public;
grant execute on function gateway.vl_record_findings(uuid, uuid, uuid, jsonb) to authority_gateway;

create or replace function gateway.vl_register_regression(p_tenant uuid, p_remediation uuid, p_key text, p_scenario_version uuid, p_description text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_id uuid;
begin
  insert into public.validation_regressions (tenant_id, scenario_key, scenario_version_id, origin_remediation_id, description)
  values (p_tenant, p_key, p_scenario_version, p_remediation, left(p_description, 500))
  on conflict (tenant_id, scenario_key) do update set scenario_version_id = excluded.scenario_version_id, origin_remediation_id = excluded.origin_remediation_id
  returning id into v_id;
  update public.validation_remediations set regression_scenario_version_id = p_scenario_version where id = p_remediation and tenant_id = p_tenant;
  return v_id;
end;
$fn$;
revoke all on function gateway.vl_register_regression(uuid, uuid, text, uuid, text) from public;
grant execute on function gateway.vl_register_regression(uuid, uuid, text, uuid, text) to authority_gateway;

create or replace function gateway.vl_record_verification(p_tenant uuid, p_remediation uuid, p_before uuid, p_after uuid, p_status text, p_verification jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.validation_remediations set before_run_id = p_before, after_run_id = p_after, verification = p_verification,
      status = case when p_status = 'verified' then 'verified' else 'failed_verification' end
    where id = p_remediation and tenant_id = p_tenant and status in ('accepted', 'verified', 'failed_verification');
  update public.validation_findings set status = case when p_status = 'verified' then 'fixed' else status end
    where id = (select finding_id from public.validation_remediations where id = p_remediation and tenant_id = p_tenant);
end;
$fn$;
revoke all on function gateway.vl_record_verification(uuid, uuid, uuid, uuid, text, jsonb) from public;
grant execute on function gateway.vl_record_verification(uuid, uuid, uuid, uuid, text, jsonb) to authority_gateway;

create or replace function gateway.vl_update_regression_result(p_tenant uuid, p_regression uuid, p_run uuid, p_status text)
returns void
language sql
security definer
set search_path = ''
as $$ update public.validation_regressions set last_run_id = p_run, last_status = p_status, last_run_at = now() where id = p_regression and tenant_id = p_tenant; $$;
revoke all on function gateway.vl_update_regression_result(uuid, uuid, uuid, text) from public;
grant execute on function gateway.vl_update_regression_result(uuid, uuid, uuid, text) to authority_gateway;

-- Human decision on a remediation proposal (runs in the reviewer's own session). Accepting changes NOTHING about the
-- tenant's real contracts, policies or registry: it only marks the proposal accepted so a regression test can be
-- generated and a before/after rerun executed inside a sandbox.
create or replace function public.decide_validation_remediation(p_id uuid, p_decision text, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  r public.validation_remediations%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'requires an authenticated caller' using errcode = '28000'; end if;
  if p_decision not in ('accept', 'reject') then raise exception 'decision must be accept or reject' using errcode = '22023'; end if;
  select * into r from public.validation_remediations where id = p_id;
  if r.id is null or not authz.is_member_of(r.tenant_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if not authz.has_min_role(r.tenant_id, 'security_admin') then raise exception 'insufficient privileges' using errcode = '42501'; end if;
  if r.status <> 'proposed' then return r.status; end if;
  update public.validation_remediations
    set status = case when p_decision = 'accept' then 'accepted' else 'rejected' end, decided_by = (select auth.uid()), decided_at = now(),
        decision_note = nullif(left(btrim(p_note), 1000), '')
    where id = p_id;
  update public.validation_findings set status = case when p_decision = 'accept' then 'accepted' else 'rejected' end
    where id = r.finding_id and status in ('open', 'remediation_proposed');
  return case when p_decision = 'accept' then 'accepted' else 'rejected' end;
end;
$fn$;
revoke all on function public.decide_validation_remediation(uuid, text, text) from public, anon;
grant execute on function public.decide_validation_remediation(uuid, text, text) to authenticated;
