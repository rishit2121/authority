-- Developer API, part 1: the task lifecycle (candidate plan -> propose ->
-- activate) becomes reachable from an application's own backend credential,
-- not only from a signed-in dashboard session -- the missing piece that
-- forced every previous example to "open the dashboard and click Activate"
-- for even a trivial, verified-safe task.
--
-- Design: the three RPCs that actually mutate state
-- (create_candidate_plan, propose_task_contract, activate_task_contract)
-- each had their real logic duplicated behind an `auth.uid()`-gated
-- permission check. Rather than copy that logic a second time for a
-- backend-credential caller (two authorization engines evaluating the same
-- facts differently is exactly the kind of drift this schema works hard to
-- avoid elsewhere), each is split into a shared `gateway.*_core` function
-- containing everything AFTER the permission check, and a thin
-- `public.*` wrapper (dashboard, auth.uid()-gated, byte-identical
-- behavior to before) plus a new `gateway.*_for_backend` wrapper
-- (backend-credential-gated) that both call the same core. The validator,
-- solver, compiler and verifier themselves are unmoved TypeScript
-- (src/lib/authorization/*) called identically from both paths.
--
-- Automatic activation is deliberately narrow: a backend-driven activation
-- attempt is eligible ONLY when (a) the contract's own, just-recompiled
-- `required_approvals_spec` is empty -- the compiler's own deterministic
-- decision that this task needs no human sign-off, never a caller-supplied
-- risk label -- AND (b) every one of the contract's allowed tools matches
-- an admin-configured automation policy for this exact application. Both
-- conditions are checked database-side, from the contract row itself, not
-- trusted from the caller. A contract that fails either check is left
-- exactly as `propose_task_contract` leaves it (`proposed`), for a human to
-- activate from the dashboard as today -- this feature only ever skips a
-- click that was always going to say yes, never any check.

-- ---------------------------------------------------------------------------
-- 1. Automation policies: durable, admin-configured, audited opt-in.
-- ---------------------------------------------------------------------------
create table public.automation_policies (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  application_id uuid not null,
  -- A single tool this application's backend may activate without a human
  -- approving -- e.g. 'gmail.list_labels'. One row per tool, not a glob:
  -- an admin enabling automation for a tool they didn't mean to is a much
  -- narrower mistake to make (and to audit) than a pattern that silently
  -- grows to match a tool added to the registry later.
  tool          text not null check (tool ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null,
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users (id) on delete set null,
  unique (id, tenant_id),
  foreign key (application_id, tenant_id) references public.applications (id, tenant_id),
  check ((revoked_at is not null) = (revoked_by is not null))
);
comment on table public.automation_policies is
  'Per-application allowlist of tools whose contracts may activate automatically '
  'through the backend credential, when the compiler itself also requires no '
  'approval. Never a substitute for the compiler''s own risk/approval decision -- '
  'only a gate on which already-zero-approval contracts an application may activate '
  'without a human click.';

alter table public.automation_policies enable row level security;
revoke all on public.automation_policies from public, anon, authenticated;
grant select (id, tenant_id, application_id, tool, created_at, created_by, revoked_at, revoked_by)
  on public.automation_policies to authenticated;
create policy "automation_policies_select_within_tenant" on public.automation_policies
  for select to authenticated using (authz.is_member_of(tenant_id));

create unique index automation_policies_one_active_per_tool
  on public.automation_policies (application_id, tool) where revoked_at is null;

create or replace function public.create_automation_policy(p_application_id uuid, p_tool text)
returns table (cap_status text, cap_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'create_automation_policy() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.applications where id = p_application_id;
  if v_tenant_id is null then
    raise exception 'application not found' using errcode = 'P0002';
  end if;
  -- security_admin+, not merely admin: this is a standing grant of
  -- unattended activation authority, a materially different decision than
  -- everyday application administration.
  if not authz.has_min_role(v_tenant_id, 'security_admin') then
    return query select 'forbidden'::text, null::uuid; return;
  end if;

  if p_tool is null or p_tool !~ '^[a-z0-9_]+\.[a-z0-9_]+$' then
    return query select 'invalid_tool'::text, null::uuid; return;
  end if;

  insert into public.automation_policies (tenant_id, application_id, tool, created_by)
  values (v_tenant_id, p_application_id, btrim(p_tool), (select auth.uid()))
  on conflict (application_id, tool) where revoked_at is null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.automation_policies
    where application_id = p_application_id and tool = btrim(p_tool) and revoked_at is null;
    return query select 'ok'::text, v_id; return;
  end if;

  return query select 'ok'::text, v_id;
end;
$fn$;
revoke all on function public.create_automation_policy(uuid, text) from public, anon;
grant execute on function public.create_automation_policy(uuid, text) to authenticated;

create or replace function public.revoke_automation_policy(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'revoke_automation_policy() requires an authenticated caller' using errcode = '28000';
  end if;
  select tenant_id into v_tenant_id from public.automation_policies where id = p_id;
  if v_tenant_id is null then
    return 'not_found';
  end if;
  if not authz.has_min_role(v_tenant_id, 'security_admin') then
    return 'forbidden';
  end if;
  update public.automation_policies set revoked_at = now(), revoked_by = (select auth.uid())
  where id = p_id and revoked_at is null;
  return 'ok';
end;
$fn$;
revoke all on function public.revoke_automation_policy(uuid) from public, anon;
grant execute on function public.revoke_automation_policy(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Shared cores -- the exact logic the existing public RPCs already ran,
--    unindented and unmodified below the permission check, just relocated.
-- ---------------------------------------------------------------------------
create or replace function gateway.create_candidate_plan_core(
  p_tenant_id uuid, p_task_id uuid, p_nodes jsonb, p_input_hash text, p_idempotency_key text
)
returns table (plan_id uuid, version integer, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_node_count integer;
  v_existing_plan_id uuid;
  v_existing_version integer;
  v_existing_input_hash text;
  v_new_plan_id uuid;
  v_new_version integer;
  v_bad_ref record;
begin
  if p_input_hash is null or p_input_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'input_hash must be 64 lowercase hex characters' using errcode = '22023';
  end if;
  if p_idempotency_key is not null and char_length(p_idempotency_key) > 200 then
    raise exception 'idempotency key exceeds maximum length' using errcode = '22023';
  end if;

  v_node_count := jsonb_array_length(p_nodes);
  if v_node_count is null or v_node_count < 1 or v_node_count > 50 then
    raise exception 'candidate plan must have between 1 and 50 nodes' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.candidate_plan_version:' || p_task_id::text, 0));

  if p_idempotency_key is not null then
    select p.id, p.version, p.input_hash
      into v_existing_plan_id, v_existing_version, v_existing_input_hash
    from public.plans p
    where p.task_id = p_task_id and p.idempotency_key = p_idempotency_key;

    if v_existing_plan_id is not null then
      if v_existing_input_hash = p_input_hash then
        return query select v_existing_plan_id, v_existing_version, false;
        return;
      end if;
      raise exception 'idempotency key % was already used for this task with different content', p_idempotency_key
        using errcode = '23505';
    end if;
  end if;

  select coalesce(max(p.version), 0) + 1 into v_new_version from public.plans p where p.task_id = p_task_id;

  insert into public.plans (tenant_id, task_id, version, idempotency_key, input_hash)
  values (p_tenant_id, p_task_id, v_new_version, p_idempotency_key, p_input_hash)
  returning id into v_new_plan_id;

  insert into public.plan_nodes (
    tenant_id, plan_id, node_key, sequence_no, tool, operation, resource,
    normalized_arguments, dependencies, declared_outputs, data_flow_refs,
    max_invocations, validation_status, expected_effect
  )
  select
    p_tenant_id,
    v_new_plan_id,
    elem ->> 'id',
    (elem ->> 'sequence')::integer,
    elem ->> 'tool',
    split_part(elem ->> 'tool', '.', 2),
    elem ->> 'resource_binding',
    jsonb_build_object('schemaVersion', 1, 'values', coalesce(elem -> 'arguments', '{}'::jsonb)),
    coalesce((select array_agg(x) from jsonb_array_elements_text(elem -> 'dependencies') as x), '{}'::text[]),
    jsonb_build_object('schemaVersion', 1, 'outputs', coalesce(elem -> 'declared_outputs', '[]'::jsonb)),
    jsonb_build_object('schemaVersion', 1, 'refs', coalesce(elem -> 'data_flow_refs', '[]'::jsonb)),
    (elem ->> 'max_invocations')::integer,
    (elem ->> 'validation_status')::public.plan_node_validation_status,
    elem ->> 'expected_effect'
  from jsonb_array_elements(p_nodes) as elem;

  select n.node_key, dep as bad_dependency
    into v_bad_ref
  from public.plan_nodes n
  cross join lateral unnest(n.dependencies) as dep
  where n.plan_id = v_new_plan_id
    and not exists (
      select 1 from public.plan_nodes d
      where d.plan_id = n.plan_id and d.node_key = dep and d.sequence_no < n.sequence_no
    )
  limit 1;

  if v_bad_ref is not null then
    raise exception 'node % has an invalid dependency reference to %: not present in this plan or not strictly earlier',
      v_bad_ref.node_key, v_bad_ref.bad_dependency
      using errcode = '23514';
  end if;

  select n.node_key
    into v_bad_ref
  from public.plan_nodes n
  cross join lateral jsonb_array_elements(n.data_flow_refs -> 'refs') as ref
  where n.plan_id = v_new_plan_id
    and not exists (
      select 1 from public.plan_nodes src
      where src.plan_id = n.plan_id
        and src.node_key = (ref ->> 'fromNodeId')
        and src.sequence_no < n.sequence_no
        and (src.declared_outputs -> 'outputs') ? (ref ->> 'output')
    )
  limit 1;

  if v_bad_ref is not null then
    raise exception 'node % has an invalid data-flow reference', v_bad_ref.node_key
      using errcode = '23514';
  end if;

  return query select v_new_plan_id, v_new_version, true;
end;
$fn$;
revoke all on function gateway.create_candidate_plan_core(uuid, uuid, jsonb, text, text) from public;

create or replace function gateway.propose_task_contract_core(
  p_tenant_id uuid, p_task_id uuid, p_plan_id uuid, p_allowed_actions jsonb, p_forbidden_resources text[],
  p_forbidden_operations text[], p_ephemeral_limits jsonb, p_data_flow_bindings jsonb, p_required_approvals jsonb,
  p_required_approvals_spec jsonb, p_registry_version text, p_compiler_version text, p_input_hash text,
  p_output_hash text, p_verifier_result jsonb, p_objective_trace jsonb
)
returns table (contract_id uuid, version integer, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_plan_tenant_id uuid;
  v_existing_id uuid;
  v_existing_version integer;
  v_existing_output_hash text;
  v_new_id uuid;
  v_new_version integer;
begin
  select tenant_id into v_plan_tenant_id from public.plans where id = p_plan_id;
  if v_plan_tenant_id is null or v_plan_tenant_id <> p_tenant_id then
    raise exception 'plan does not belong to the target task''s tenant' using errcode = '23503';
  end if;

  if p_input_hash is null or p_input_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'input_hash must be 64 lowercase hex characters' using errcode = '22023';
  end if;
  if p_output_hash is null or p_output_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'output_hash must be 64 lowercase hex characters' using errcode = '22023';
  end if;
  if p_registry_version is null or char_length(p_registry_version) < 1 then
    raise exception 'registry_version is required' using errcode = '22023';
  end if;
  if p_compiler_version is null or char_length(p_compiler_version) < 1 then
    raise exception 'compiler_version is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.contract_version:' || p_task_id::text, 0));

  select tac.id, tac.version, tac.output_hash
    into v_existing_id, v_existing_version, v_existing_output_hash
  from public.task_authority_contracts tac
  where tac.task_id = p_task_id
    and tac.plan_id = p_plan_id
    and tac.registry_version = p_registry_version
    and tac.compiler_version = p_compiler_version
    and tac.input_hash = p_input_hash
    and tac.demo_key is null;

  if v_existing_id is not null then
    if v_existing_output_hash = p_output_hash then
      return query select v_existing_id, v_existing_version, false;
      return;
    end if;
    raise exception 'deterministic compiler invariant violated: identical compilation identity (task, plan, registry version, compiler version, input hash) produced a different output hash'
      using errcode = '55000';
  end if;

  select coalesce(max(tac.version), 0) + 1 into v_new_version
  from public.task_authority_contracts tac
  where tac.task_id = p_task_id;

  insert into public.task_authority_contracts (
    tenant_id, task_id, plan_id, version, spec_version, allowed_actions, forbidden_resources,
    forbidden_operations, ephemeral_limits, contract_status, registry_version, compiler_version,
    input_hash, output_hash, data_flow_bindings, required_approvals, required_approvals_spec
  ) values (
    p_tenant_id, p_task_id, p_plan_id, v_new_version, 'v1', p_allowed_actions,
    coalesce(p_forbidden_resources, '{}'), coalesce(p_forbidden_operations, '{}'),
    p_ephemeral_limits, 'proposed', p_registry_version, p_compiler_version,
    p_input_hash, p_output_hash, p_data_flow_bindings, p_required_approvals, p_required_approvals_spec
  )
  returning id into v_new_id;

  insert into public.contract_compilations (
    tenant_id, task_id, plan_id, contract_id, registry_version, compiler_version,
    input_hash, output_hash, verifier_result, objective_trace
  ) values (
    p_tenant_id, p_task_id, p_plan_id, v_new_id, p_registry_version, p_compiler_version,
    p_input_hash, p_output_hash, p_verifier_result, p_objective_trace
  );

  return query select v_new_id, v_new_version, true;
end;
$fn$;
revoke all on function gateway.propose_task_contract_core(
  uuid, uuid, uuid, jsonb, text[], text[], jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb, jsonb
) from public;

-- `p_activator_principal_id` replaces activate_task_contract()'s own
-- internal `select ... from principals where user_id = auth.uid()` -- the
-- one piece of the original body that was caller-identity-specific. The
-- dashboard wrapper resolves it from auth.uid() exactly as before; the
-- backend wrapper resolves it from the application's own service principal
-- (gateway.ensure_application_service_principal).
create or replace function gateway.activate_task_contract_core(
  p_contract_id uuid, p_activator_principal_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_task_id uuid;
  v_status public.contract_status;
  v_ephemeral_limits jsonb;
  v_required_approvals_spec jsonb;
  v_expires_at timestamptz;
  v_existing_active_id uuid;
  v_item jsonb;
begin
  select tenant_id, task_id, contract_status, ephemeral_limits, required_approvals_spec
    into v_tenant_id, v_task_id, v_status, v_ephemeral_limits, v_required_approvals_spec
  from public.task_authority_contracts
  where id = p_contract_id;

  if v_tenant_id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;

  if v_status not in ('proposed', 'awaiting_approval') then
    raise exception 'contract is not in a state that can be activated' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.contract_activation:' || v_task_id::text, 0));

  for v_item in select * from jsonb_array_elements(coalesce(v_required_approvals_spec -> 'items', '[]'::jsonb))
  loop
    if exists (
      select 1 from public.approvals a
      where a.contract_id = p_contract_id
        and a.required_kind = (v_item ->> 'kind')::public.approval_requirement_kind
        and a.required_role is not distinct from nullif(v_item ->> 'role', '')::public.tenant_role
        and a.status <> 'approved'
    ) then
      raise exception 'a required approval is missing or was rejected (kind %, role %)',
        v_item ->> 'kind', v_item ->> 'role'
        using errcode = '23514';
    end if;
  end loop;

  select id into v_existing_active_id
  from public.task_authority_contracts
  where task_id = v_task_id and contract_status = 'active' and id <> p_contract_id;

  v_expires_at := now() + make_interval(secs => (v_ephemeral_limits ->> 'expiresInSeconds')::integer);

  if v_existing_active_id is not null then
    update public.task_authority_contracts
    set contract_status = 'superseded', superseded_at = now(), superseded_by_contract_id = p_contract_id
    where id = v_existing_active_id;
  end if;

  update public.task_authority_contracts
  set contract_status = 'active', activated_at = now(), activated_by_principal_id = p_activator_principal_id,
      expires_at = v_expires_at
  where id = p_contract_id and contract_status in ('proposed', 'awaiting_approval');

  if not found then
    raise exception 'contract is not in a state that can be activated' using errcode = '23514';
  end if;

  update public.tasks
  set status = 'contract_issued', updated_at = now()
  where id = v_task_id and status = 'pending';
end;
$fn$;
revoke all on function gateway.activate_task_contract_core(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- 3. public.* wrappers: same signature, same auth.uid() gate, byte-identical
--    behavior to before -- just delegating to the shared core above.
-- ---------------------------------------------------------------------------
create or replace function public.create_candidate_plan(
  p_task_id uuid, p_nodes jsonb, p_input_hash text, p_idempotency_key text default null
)
returns table (plan_id uuid, version integer, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'create_candidate_plan() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.tasks where id = p_task_id;
  if v_tenant_id is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  if not authz.has_min_role(v_tenant_id, 'developer') then
    raise exception 'insufficient privileges to create a candidate plan for this task' using errcode = '42501';
  end if;

  return query select * from gateway.create_candidate_plan_core(v_tenant_id, p_task_id, p_nodes, p_input_hash, p_idempotency_key);
end;
$fn$;
revoke all on function public.create_candidate_plan(uuid, jsonb, text, text) from public, anon;
grant execute on function public.create_candidate_plan(uuid, jsonb, text, text) to authenticated;

create or replace function public.propose_task_contract(
  p_task_id uuid, p_plan_id uuid, p_allowed_actions jsonb, p_forbidden_resources text[],
  p_forbidden_operations text[], p_ephemeral_limits jsonb, p_data_flow_bindings jsonb, p_required_approvals jsonb,
  p_required_approvals_spec jsonb, p_registry_version text, p_compiler_version text, p_input_hash text,
  p_output_hash text, p_verifier_result jsonb, p_objective_trace jsonb
)
returns table (contract_id uuid, version integer, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'propose_task_contract() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.tasks where id = p_task_id;
  if v_tenant_id is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  if not authz.has_min_role(v_tenant_id, 'developer') then
    raise exception 'insufficient privileges to propose a contract for this task' using errcode = '42501';
  end if;

  return query select * from gateway.propose_task_contract_core(
    v_tenant_id, p_task_id, p_plan_id, p_allowed_actions, p_forbidden_resources, p_forbidden_operations,
    p_ephemeral_limits, p_data_flow_bindings, p_required_approvals, p_required_approvals_spec,
    p_registry_version, p_compiler_version, p_input_hash, p_output_hash, p_verifier_result, p_objective_trace
  );
end;
$fn$;
revoke all on function public.propose_task_contract(
  uuid, uuid, jsonb, text[], text[], jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb, jsonb
) from public, anon;
grant execute on function public.propose_task_contract(
  uuid, uuid, jsonb, text[], text[], jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb, jsonb
) to authenticated;

create or replace function public.activate_task_contract(p_contract_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_activator_principal_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'activate_task_contract() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.task_authority_contracts where id = p_contract_id;
  if v_tenant_id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;

  if not authz.has_min_role(v_tenant_id, 'admin') then
    raise exception 'insufficient privileges to activate this contract' using errcode = '42501';
  end if;

  select id into v_activator_principal_id
  from public.principals
  where tenant_id = v_tenant_id and user_id = (select auth.uid());

  perform gateway.activate_task_contract_core(p_contract_id, v_activator_principal_id);
end;
$fn$;
revoke all on function public.activate_task_contract(uuid) from public, anon;
grant execute on function public.activate_task_contract(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Backend-credential-facing surface: reads the TS pipeline needs to
--    re-run validate/solve/compile/verify, plus the write wrappers.
-- ---------------------------------------------------------------------------

-- Confirms the task is customer-scoped and belongs to this backend
-- credential's own application -- the same ownership boundary every other
-- customer-developer-API function in this schema already enforces -- and
-- returns what the TS pipeline needs to load the registry and run
-- validation (tenantId, intent).
create or replace function gateway.get_task_for_backend(p_secret text, p_task_id uuid)
returns table (gtb_status text, gtb_tenant_id uuid, gtb_intent text, gtb_customer_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid;
  v_task_tenant uuid; v_task_customer uuid; v_task_intent text;
  v_customer_app uuid;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::text, null::uuid; return;
  end if;

  select tenant_id, customer_id, intent into v_task_tenant, v_task_customer, v_task_intent
  from public.tasks where id = p_task_id;
  if v_task_tenant is null or v_task_tenant <> v_tenant or v_task_customer is null then
    return query select 'task_not_found'::text, null::uuid, null::text, null::uuid; return;
  end if;

  select application_id into v_customer_app from public.customers where id = v_task_customer;
  if v_customer_app is null or v_customer_app <> v_app then
    return query select 'task_not_found'::text, null::uuid, null::text, null::uuid; return;
  end if;

  return query select 'ok'::text, v_task_tenant, v_task_intent, v_task_customer;
end;
$fn$;
revoke all on function gateway.get_task_for_backend(text, uuid) from public;
grant execute on function gateway.get_task_for_backend(text, uuid) to authority_gateway;

-- Every active policy for this backend credential's own tenant -- the same
-- rows validateCandidatePlan/deriveRequiredApprovals already take as input
-- on the dashboard path, just fetched through the gateway pool instead of
-- an RLS-scoped client.
create or replace function gateway.list_active_policies_for_backend(p_secret text)
returns table (
  lap_status text, lap_id uuid, lap_name text, lap_description text, lap_version integer,
  lap_status_value text, lap_effect text, lap_conditions jsonb, lap_required_approval_role text,
  lap_required_approval_count integer, lap_created_at timestamptz, lap_activated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid;
begin
  select rbc_status, rbc_tenant_id into v_status, v_tenant
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::text, null::text, null::integer, null::text, null::text,
      null::jsonb, null::text, null::integer, null::timestamptz, null::timestamptz;
    return;
  end if;

  return query
    select 'ok'::text, p.id, p.name, p.description, p.version, p.status::text, p.effect::text, p.conditions,
      p.required_approval_role::text, p.required_approval_count, p.created_at, p.activated_at
    from public.policies p
    where p.tenant_id = v_tenant
    order by p.name asc, p.version desc;
end;
$fn$;
revoke all on function gateway.list_active_policies_for_backend(text) from public;
grant execute on function gateway.list_active_policies_for_backend(text) to authority_gateway;

-- The exact plan-node rows loadCandidatePlanForActivation reconstructs a
-- CandidatePlan from, scoped to this backend credential's own tenant.
create or replace function gateway.get_plan_nodes_for_backend(p_secret text, p_plan_id uuid)
returns table (
  gpn_status text, gpn_node_key text, gpn_sequence_no integer, gpn_tool text, gpn_resource text,
  gpn_normalized_arguments jsonb, gpn_dependencies text[], gpn_declared_outputs jsonb,
  gpn_data_flow_refs jsonb, gpn_max_invocations integer, gpn_validation_status text, gpn_expected_effect text
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_plan_tenant uuid;
begin
  select rbc_status, rbc_tenant_id into v_status, v_tenant
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then
    return query select v_status, null::text, null::integer, null::text, null::text, null::jsonb,
      null::text[], null::jsonb, null::jsonb, null::integer, null::text, null::text;
    return;
  end if;

  select tenant_id into v_plan_tenant from public.plans where id = p_plan_id;
  if v_plan_tenant is null or v_plan_tenant <> v_tenant then
    return query select 'not_found'::text, null::text, null::integer, null::text, null::text, null::jsonb,
      null::text[], null::jsonb, null::jsonb, null::integer, null::text, null::text;
    return;
  end if;

  return query
    select 'ok'::text, n.node_key, n.sequence_no, n.tool, n.resource, n.normalized_arguments, n.dependencies,
      n.declared_outputs, n.data_flow_refs, n.max_invocations, n.validation_status::text, n.expected_effect::text
    from public.plan_nodes n where n.plan_id = p_plan_id order by n.sequence_no asc;
end;
$fn$;
revoke all on function gateway.get_plan_nodes_for_backend(text, uuid) from public;
grant execute on function gateway.get_plan_nodes_for_backend(text, uuid) to authority_gateway;

create or replace function gateway.create_candidate_plan_for_backend(
  p_secret text, p_task_id uuid, p_nodes jsonb, p_input_hash text, p_idempotency_key text
)
returns table (ccp_status text, ccp_plan_id uuid, ccp_version integer, ccp_was_created boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid;
  v_task_status text; v_task_tenant uuid; v_task_intent text; v_task_customer uuid;
  v_core record;
begin
  select rbc_status, rbc_tenant_id into v_status, v_tenant from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::integer, null::boolean; return;
  end if;

  select gtb_status, gtb_tenant_id, gtb_intent, gtb_customer_id
    into v_task_status, v_task_tenant, v_task_intent, v_task_customer
  from gateway.get_task_for_backend(p_secret, p_task_id);
  if v_task_status <> 'ok' then
    return query select v_task_status, null::uuid, null::integer, null::boolean; return;
  end if;

  select * into v_core from gateway.create_candidate_plan_core(v_tenant, p_task_id, p_nodes, p_input_hash, p_idempotency_key);
  return query select 'ok'::text, v_core.plan_id, v_core.version, v_core.was_created;
end;
$fn$;
revoke all on function gateway.create_candidate_plan_for_backend(text, uuid, jsonb, text, text) from public;
grant execute on function gateway.create_candidate_plan_for_backend(text, uuid, jsonb, text, text) to authority_gateway;

create or replace function gateway.propose_task_contract_for_backend(
  p_secret text, p_task_id uuid, p_plan_id uuid, p_allowed_actions jsonb, p_forbidden_resources text[],
  p_forbidden_operations text[], p_ephemeral_limits jsonb, p_data_flow_bindings jsonb, p_required_approvals jsonb,
  p_required_approvals_spec jsonb, p_registry_version text, p_compiler_version text, p_input_hash text,
  p_output_hash text, p_verifier_result jsonb, p_objective_trace jsonb
)
returns table (ptc_status text, ptc_contract_id uuid, ptc_version integer, ptc_was_created boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid;
  v_task_status text; v_task_tenant uuid; v_task_intent text; v_task_customer uuid;
  v_core record;
begin
  select rbc_status, rbc_tenant_id into v_status, v_tenant from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::integer, null::boolean; return;
  end if;

  select gtb_status, gtb_tenant_id, gtb_intent, gtb_customer_id
    into v_task_status, v_task_tenant, v_task_intent, v_task_customer
  from gateway.get_task_for_backend(p_secret, p_task_id);
  if v_task_status <> 'ok' then
    return query select v_task_status, null::uuid, null::integer, null::boolean; return;
  end if;

  select * into v_core from gateway.propose_task_contract_core(
    v_tenant, p_task_id, p_plan_id, p_allowed_actions, p_forbidden_resources, p_forbidden_operations,
    p_ephemeral_limits, p_data_flow_bindings, p_required_approvals, p_required_approvals_spec,
    p_registry_version, p_compiler_version, p_input_hash, p_output_hash, p_verifier_result, p_objective_trace
  );
  return query select 'ok'::text, v_core.contract_id, v_core.version, v_core.was_created;
end;
$fn$;
revoke all on function gateway.propose_task_contract_for_backend(
  text, uuid, uuid, jsonb, text[], text[], jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb, jsonb
) from public;
grant execute on function gateway.propose_task_contract_for_backend(
  text, uuid, uuid, jsonb, text[], text[], jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb, jsonb
) to authority_gateway;

-- Reads a proposed contract's own stored allowed-tools list and required-
-- approvals spec -- what gateway.activate_task_contract_for_backend checks
-- eligibility against, and what the TS orchestration layer uses to decide
-- whether to even attempt activation before re-running the pipeline.
create or replace function gateway.get_contract_for_backend(p_secret text, p_contract_id uuid)
returns table (
  gcb_status text, gcb_task_id uuid, gcb_plan_id uuid, gcb_contract_status text, gcb_tools text[],
  gcb_required_approvals_count integer, gcb_registry_version text, gcb_compiler_version text,
  gcb_input_hash text, gcb_output_hash text
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid;
  v_contract_tenant uuid; v_task_id uuid;
begin
  select rbc_status, rbc_tenant_id into v_status, v_tenant from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::uuid, null::text, null::text[], null::integer, null::text, null::text, null::text, null::text;
    return;
  end if;

  select tenant_id, task_id into v_contract_tenant, v_task_id
  from public.task_authority_contracts where id = p_contract_id;
  if v_contract_tenant is null or v_contract_tenant <> v_tenant then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text, null::text[], null::integer, null::text, null::text, null::text, null::text;
    return;
  end if;

  return query
    select 'ok'::text, tac.task_id, tac.plan_id, tac.contract_status::text,
      (select coalesce(array_agg(item ->> 'tool'), '{}') from jsonb_array_elements(tac.allowed_actions -> 'items') as item),
      coalesce(jsonb_array_length(tac.required_approvals_spec -> 'items'), 0),
      tac.registry_version, tac.compiler_version, tac.input_hash, tac.output_hash
    from public.task_authority_contracts tac where tac.id = p_contract_id;
end;
$fn$;
revoke all on function gateway.get_contract_for_backend(text, uuid) from public;
grant execute on function gateway.get_contract_for_backend(text, uuid) to authority_gateway;

-- The one entry point that can actually grant runtime authority through the
-- backend credential. Eligibility -- both conditions read from the
-- CONTRACT ROW itself, never from anything the caller asserts -- is: every
-- allowed tool matches an active automation_policies row for this exact
-- application, AND required_approvals_spec is empty. Anything else returns
-- 'not_eligible' and activates nothing; a human can still activate the same
-- contract from the dashboard exactly as before.
create or replace function gateway.activate_task_contract_for_backend(p_secret text, p_contract_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid;
  v_contract_tenant uuid; v_task_id uuid; v_task_customer uuid; v_customer_app uuid;
  v_tools text[];
  v_approvals_count integer;
  v_missing_policy boolean;
  v_activator_principal_id uuid;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then return v_status; end if;

  select tenant_id, task_id into v_contract_tenant, v_task_id
  from public.task_authority_contracts where id = p_contract_id;
  if v_contract_tenant is null or v_contract_tenant <> v_tenant then
    return 'not_found';
  end if;

  select customer_id into v_task_customer from public.tasks where id = v_task_id;
  if v_task_customer is null then return 'not_found'; end if;
  select application_id into v_customer_app from public.customers where id = v_task_customer;
  if v_customer_app is null or v_customer_app <> v_app then return 'not_found'; end if;

  select
    (select coalesce(array_agg(item ->> 'tool'), '{}') from jsonb_array_elements(tac.allowed_actions -> 'items') as item),
    coalesce(jsonb_array_length(tac.required_approvals_spec -> 'items'), 0)
    into v_tools, v_approvals_count
  from public.task_authority_contracts tac where tac.id = p_contract_id;

  if v_approvals_count > 0 then
    return 'not_eligible';
  end if;

  select exists (
    select 1 from unnest(v_tools) as t
    where not exists (
      select 1 from public.automation_policies ap
      where ap.application_id = v_app and ap.tool = t and ap.revoked_at is null
    )
  ) into v_missing_policy;
  if v_missing_policy or array_length(v_tools, 1) is null then
    return 'not_eligible';
  end if;

  v_activator_principal_id := gateway.ensure_application_service_principal(v_tenant, v_app);

  perform gateway.activate_task_contract_core(p_contract_id, v_activator_principal_id);
  return 'ok';
exception
  when others then
    -- activate_task_contract_core raises on a stale/non-activatable state
    -- (e.g. lost a race, already active) -- surfaced as a plain status
    -- rather than an exception, consistent with every other backend-API
    -- function in this schema.
    return 'not_eligible';
end;
$fn$;
revoke all on function gateway.activate_task_contract_for_backend(text, uuid) from public;
grant execute on function gateway.activate_task_contract_for_backend(text, uuid) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000014'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
