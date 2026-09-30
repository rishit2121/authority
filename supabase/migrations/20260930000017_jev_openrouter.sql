-- Jev/OpenRouter: per-tenant settings, and append-only audit trails for necessity evaluation (role B, propose-time),
-- plan-level completeness evaluation (role B extension) and runtime risk evaluation (role C, shadow mode only).
--
-- Three roles, kept separate in schema exactly as in code: `jev_necessity_evaluations` and
-- `jev_plan_completeness_evaluations` are written from the authenticated contract-proposal flow (same security
-- pattern as `create_candidate_plan`/`contract_compilations` — SECURITY DEFINER, re-derives the caller's own tenant
-- and role, granted to `authenticated`). `jev_risk_evaluations` is written only from the runtime gateway path (same
-- pattern as `semantic_evaluations` — granted only to `authority_gateway`, never `authenticated`).
--
-- Nothing here changes an authorization decision. Necessity evaluation can gate what reaches the solver only when a
-- tenant has explicitly turned `jev_settings.necessity_mode` to 'enforce' (off by default); risk evaluation has no
-- enforce mode at all yet — the column only ever accepts 'off' or 'shadow', so enforcement is not merely
-- default-off, it is not a value the schema can represent yet (see docs/jev/OVERVIEW.md's future-narrowing design).

create table public.jev_settings (
  tenant_id       uuid primary key references public.tenants (id) on delete cascade,
  necessity_mode  text not null default 'off' check (necessity_mode in ('off', 'shadow', 'enforce')),
  risk_mode       text not null default 'off' check (risk_mode in ('off', 'shadow')),
  -- Mirrors semantic_settings' enforcement_approved_at gate: an admin must have explicitly approved enforce mode at
  -- some point for it to be selectable; clearing it (by picking a lower mode) requires re-approval to go back up.
  enforcement_approved_at timestamptz,
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);
alter table public.jev_settings enable row level security;
revoke all on public.jev_settings from public, anon, authenticated;
grant select on public.jev_settings to authenticated;
create policy jev_settings_select_within_tenant on public.jev_settings
  for select to authenticated using (authz.is_member_of(tenant_id));

create or replace function public.set_jev_settings(
  p_tenant_id uuid, p_necessity_mode text, p_risk_mode text, p_approve_enforcement boolean
)
returns table (necessity_mode text, risk_mode text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_approved_at timestamptz;
begin
  if (select auth.uid()) is null then raise exception 'requires an authenticated caller' using errcode = '28000'; end if;
  if not authz.is_member_of(p_tenant_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if not authz.has_min_role(p_tenant_id, 'security_admin') then raise exception 'insufficient privileges' using errcode = '42501'; end if;
  if p_necessity_mode not in ('off', 'shadow', 'enforce') then raise exception 'invalid necessity mode' using errcode = '22023'; end if;
  if p_risk_mode not in ('off', 'shadow') then raise exception 'invalid risk mode' using errcode = '22023'; end if;

  select j.enforcement_approved_at into v_approved_at from public.jev_settings j where j.tenant_id = p_tenant_id;
  if p_necessity_mode = 'enforce' then
    if p_approve_enforcement then v_approved_at := now();
    elsif v_approved_at is null then
      raise exception 'enforce mode requires explicit approval' using errcode = '22023';
    end if;
  end if;

  insert into public.jev_settings (tenant_id, necessity_mode, risk_mode, enforcement_approved_at, updated_by)
  values (p_tenant_id, p_necessity_mode, p_risk_mode, v_approved_at, (select auth.uid()))
  on conflict (tenant_id) do update set
    necessity_mode = excluded.necessity_mode, risk_mode = excluded.risk_mode,
    enforcement_approved_at = excluded.enforcement_approved_at, updated_by = excluded.updated_by, updated_at = now();

  return query select p_necessity_mode, p_risk_mode;
end;
$fn$;
revoke all on function public.set_jev_settings(uuid, text, text, boolean) from public, anon;
grant execute on function public.set_jev_settings(uuid, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Role B: per-tool necessity evaluation (propose-time). One row per node per pipeline run — a proposal that is
-- re-validated at activation time (see contract/actions.ts's activateContractAction) produces a second row, not an
-- update to the first; this table is append-only like every other decision trail in the product.
-- ---------------------------------------------------------------------------
create table public.jev_necessity_evaluations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  task_id       uuid not null,
  plan_id       uuid not null,
  -- The candidate plan's own caller-assigned node id (`plan_nodes.node_key`'s domain-facing counterpart) — not a
  -- foreign key: a node id is stable within one plan submission but the plan itself may be resubmitted, and this
  -- table's job is to record what Jev said about a specific evaluation, not to enforce plan structure.
  node_key      text not null check (char_length(node_key) between 1 and 100),
  tool          text not null check (tool ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  registry_version text not null check (char_length(registry_version) between 1 and 40),
  compiler_version  text not null check (char_length(compiler_version) between 1 and 60),
  mode          text not null check (mode in ('shadow', 'enforce')),
  provider      text not null check (char_length(btrim(provider)) between 1 and 100),
  model         text not null check (char_length(btrim(model)) between 1 and 200),
  -- The model version OpenRouter actually reports for this call (e.g. "typesafe/jev-1.13-20260917"); may differ from `model`.
  model_version text not null check (char_length(btrim(model_version)) between 1 and 100),
  input_hash    text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  state         text not null check (state in ('ok', 'unavailable', 'timeout', 'error', 'circuit_open')),
  -- {"schemaVersion":1,"classification":..,"confidence":..,"reasonCodes":[..],"requiredPredecessorNodeIds":[..],"missingInformationCodes":[..],"alternativeOperationIds":[..]} — null exactly when state <> 'ok'.
  result        jsonb check (result is null or (authz.has_allowed_schema_version(result, array[1]) and pg_column_size(result) <= 8192)),
  mechanical_status text not null check (mechanical_status in ('accepted', 'requires_review', 'clarify', 'replan', 'denied')),
  final_status  text not null check (final_status in ('accepted', 'requires_review', 'clarify', 'replan', 'denied')),
  disagreement  boolean not null default false,
  latency_ms    integer not null check (latency_ms >= 0 and latency_ms <= 600000),
  error_category text check (error_category is null or error_category ~ '^[a-z_]{1,40}$'),
  created_at    timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (plan_id, tenant_id) references public.plans (id, tenant_id)
);
create index jev_necessity_evaluations_plan_idx on public.jev_necessity_evaluations (plan_id, node_key);
alter table public.jev_necessity_evaluations enable row level security;
revoke all on public.jev_necessity_evaluations from public, anon, authenticated;
grant select on public.jev_necessity_evaluations to authenticated;
create policy jev_necessity_evaluations_select_within_tenant on public.jev_necessity_evaluations
  for select to authenticated using (authz.is_member_of(tenant_id));
create trigger jev_necessity_evaluations_append_only
  before update or delete on public.jev_necessity_evaluations
  for each row execute function authz.forbid_update_delete();

create or replace function public.record_jev_necessity_evaluation(p_tenant_id uuid, p_row jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'requires an authenticated caller' using errcode = '28000'; end if;
  if not authz.is_member_of(p_tenant_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if not authz.has_min_role(p_tenant_id, 'developer') then raise exception 'insufficient privileges' using errcode = '42501'; end if;

  insert into public.jev_necessity_evaluations (
    tenant_id, task_id, plan_id, node_key, tool, registry_version, compiler_version, mode, provider, model,
    model_version, input_hash, state, result, mechanical_status, final_status, disagreement, latency_ms, error_category
  ) values (
    p_tenant_id, (p_row ->> 'taskId')::uuid, (p_row ->> 'planId')::uuid, p_row ->> 'nodeKey', p_row ->> 'tool',
    p_row ->> 'registryVersion', p_row ->> 'compilerVersion', p_row ->> 'mode', p_row ->> 'provider', p_row ->> 'model',
    p_row ->> 'modelVersion', p_row ->> 'inputHash', p_row ->> 'state', p_row -> 'result',
    p_row ->> 'mechanicalStatus', p_row ->> 'finalStatus', coalesce((p_row ->> 'disagreement')::boolean, false),
    (p_row ->> 'latencyMs')::integer, p_row ->> 'errorCategory'
  ) returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function public.record_jev_necessity_evaluation(uuid, jsonb) from public, anon;
grant execute on function public.record_jev_necessity_evaluation(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Role B extension: plan-level completeness. One row per pipeline run (not per node).
-- ---------------------------------------------------------------------------
create table public.jev_plan_completeness_evaluations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  task_id       uuid not null,
  plan_id       uuid not null,
  provider      text not null check (char_length(btrim(provider)) between 1 and 100),
  model         text not null check (char_length(btrim(model)) between 1 and 200),
  model_version text not null check (char_length(btrim(model_version)) between 1 and 100),
  input_hash    text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  state         text not null check (state in ('ok', 'unavailable', 'timeout', 'error', 'circuit_open')),
  -- {"schemaVersion":1,"classification":..,"confidence":..,"possibleMissingOperationIds":[..]} — null exactly when state <> 'ok'.
  result        jsonb check (result is null or (authz.has_allowed_schema_version(result, array[1]) and pg_column_size(result) <= 4096)),
  latency_ms    integer not null check (latency_ms >= 0 and latency_ms <= 600000),
  error_category text check (error_category is null or error_category ~ '^[a-z_]{1,40}$'),
  created_at    timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (plan_id, tenant_id) references public.plans (id, tenant_id)
);
alter table public.jev_plan_completeness_evaluations enable row level security;
revoke all on public.jev_plan_completeness_evaluations from public, anon, authenticated;
grant select on public.jev_plan_completeness_evaluations to authenticated;
create policy jev_plan_completeness_evaluations_select_within_tenant on public.jev_plan_completeness_evaluations
  for select to authenticated using (authz.is_member_of(tenant_id));
create trigger jev_plan_completeness_evaluations_append_only
  before update or delete on public.jev_plan_completeness_evaluations
  for each row execute function authz.forbid_update_delete();

create or replace function public.record_jev_completeness_evaluation(p_tenant_id uuid, p_row jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'requires an authenticated caller' using errcode = '28000'; end if;
  if not authz.is_member_of(p_tenant_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if not authz.has_min_role(p_tenant_id, 'developer') then raise exception 'insufficient privileges' using errcode = '42501'; end if;

  insert into public.jev_plan_completeness_evaluations (
    tenant_id, task_id, plan_id, provider, model, model_version, input_hash, state, result, latency_ms, error_category
  ) values (
    p_tenant_id, (p_row ->> 'taskId')::uuid, (p_row ->> 'planId')::uuid, p_row ->> 'provider', p_row ->> 'model',
    p_row ->> 'modelVersion', p_row ->> 'inputHash', p_row ->> 'state', p_row -> 'result',
    (p_row ->> 'latencyMs')::integer, p_row ->> 'errorCategory'
  ) returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function public.record_jev_completeness_evaluation(uuid, jsonb) from public, anon;
grant execute on function public.record_jev_completeness_evaluation(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Role C: runtime risk evaluation (shadow mode only). Mirrors `semantic_evaluations` exactly: written only from the
-- restricted gateway role, one row per authorization decision, never client-writable.
-- ---------------------------------------------------------------------------
create table public.jev_risk_evaluations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  task_id       uuid not null,
  tool_request_id uuid not null,
  authorization_decision_id uuid not null,
  agent_id      uuid not null,
  mode          text not null default 'shadow' check (mode = 'shadow'),
  provider      text not null check (char_length(btrim(provider)) between 1 and 100),
  model         text not null check (char_length(btrim(model)) between 1 and 200),
  model_version text not null check (char_length(btrim(model_version)) between 1 and 100),
  input_hash    text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  state         text not null check (state in ('ok', 'unavailable', 'timeout', 'error', 'circuit_open')),
  -- {"schemaVersion":1,"riskClass":..,"confidence":..,"categories":[..],"evidenceCodes":[..]} — null exactly when state <> 'ok'.
  result        jsonb check (result is null or (authz.has_allowed_schema_version(result, array[1]) and pg_column_size(result) <= 4096)),
  deterministic_decision text not null check (char_length(deterministic_decision) between 1 and 40),
  final_decision text not null check (char_length(final_decision) between 1 and 40),
  disagreement  boolean not null default false,
  latency_ms    integer not null check (latency_ms >= 0 and latency_ms <= 600000),
  error_category text check (error_category is null or error_category ~ '^[a-z_]{1,40}$'),
  created_at    timestamptz not null default now(),
  unique (id, tenant_id),
  unique (authorization_decision_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (tool_request_id, tenant_id) references public.tool_requests (id, tenant_id),
  foreign key (authorization_decision_id, tenant_id) references public.authorization_decisions (id, tenant_id),
  foreign key (agent_id, tenant_id) references public.agents (id, tenant_id)
);
alter table public.jev_risk_evaluations enable row level security;
revoke all on public.jev_risk_evaluations from public, anon, authenticated;
grant select on public.jev_risk_evaluations to authenticated;
create policy jev_risk_evaluations_select_within_tenant on public.jev_risk_evaluations
  for select to authenticated using (authz.is_member_of(tenant_id));
create trigger jev_risk_evaluations_append_only
  before update or delete on public.jev_risk_evaluations
  for each row execute function authz.forbid_update_delete();

comment on table public.jev_risk_evaluations is
  'Shadow-mode-only runtime risk evidence from direct Jev (role C). Written exclusively by the restricted gateway '
  'role from the same code path as semantic_evaluations, immediately after commit_authorization succeeds — never '
  'inside that transaction, so a Jev outage can never affect the authorization decision itself. Advisory only: '
  'nothing here can issue, consume, revoke or broaden a capability, and there is no enforce mode in this schema yet.';

create or replace function gateway.record_jev_risk_evaluation(p_tenant_id uuid, p_row jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_id uuid;
begin
  insert into public.jev_risk_evaluations (
    tenant_id, task_id, tool_request_id, authorization_decision_id, agent_id, provider, model, model_version,
    input_hash, state, result, deterministic_decision, final_decision, disagreement, latency_ms, error_category
  ) values (
    p_tenant_id, (p_row ->> 'taskId')::uuid, (p_row ->> 'toolRequestId')::uuid, (p_row ->> 'authorizationDecisionId')::uuid,
    (p_row ->> 'agentId')::uuid, p_row ->> 'provider', p_row ->> 'model', p_row ->> 'modelVersion', p_row ->> 'inputHash',
    p_row ->> 'state', p_row -> 'result', p_row ->> 'deterministicDecision', p_row ->> 'finalDecision',
    coalesce((p_row ->> 'disagreement')::boolean, false), (p_row ->> 'latencyMs')::integer, p_row ->> 'errorCategory'
  )
  on conflict (authorization_decision_id) do nothing
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function gateway.record_jev_risk_evaluation(uuid, jsonb) from public;
grant execute on function gateway.record_jev_risk_evaluation(uuid, jsonb) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Schema-version probe bump (see lib/gateway/schema-version.ts).
-- ---------------------------------------------------------------------------
create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20260930000017'::text $$;
