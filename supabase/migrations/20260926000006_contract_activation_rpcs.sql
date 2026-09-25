-- Part 3B: contract-approval and activation RPCs.
--
-- Trust boundary, stated plainly because it is easy to misread the presence
-- of these RPCs as "the database enforces authorization": it does not, and
-- cannot, prove that a genuine TypeScript re-verification (validate ->
-- solve -> compile -> verify against the *current* registry and policies)
-- ran before activate_task_contract() was called. A caller who bypasses the
-- real pipeline and calls this RPC directly with a stale or forged
-- contract_id gets exactly the same mechanical checks as a caller who did
-- everything right: role, tenant membership, approval satisfaction, single-
-- active-per-task, no content mutation. What this RPC cannot check is
-- whether the contract's *content* still matches what the current registry
-- and policies would produce today — that is checked in TypeScript, before
-- this RPC is ever called (see the activation server action), and is
-- exactly why `contract_status = 'active'` must never become, by itself,
-- sufficient runtime authority for anything built later: a future
-- consumption path must independently re-verify supported versions, hashes,
-- bindings, status and expiration, every time, rather than trusting that
-- this row reaching 'active' once means it is still trustworthy now.

create or replace function authz.contract_is_currently_active(
  p_status public.contract_status,
  p_expires_at timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status = 'active' and (p_expires_at is null or p_expires_at > now());
$$;

revoke all on function authz.contract_is_currently_active(public.contract_status, timestamptz) from public, anon;
grant execute on function authz.contract_is_currently_active(public.contract_status, timestamptz) to authenticated;

-- propose_task_contract(): same as Part 3A except for one new parameter,
-- p_required_approvals_spec — the TypeScript approval-rule deriver's output,
-- stored as compiled-contract content (frozen by the immutability trigger,
-- see the previous migration). The signature changed, so this is dropped
-- and recreated rather than replaced in place.
drop function if exists public.propose_task_contract(
  uuid, uuid, jsonb, text[], text[], jsonb, jsonb, jsonb, text, text, text, text, jsonb, jsonb
);

create or replace function public.propose_task_contract(
  p_task_id uuid,
  p_plan_id uuid,
  p_allowed_actions jsonb,
  p_forbidden_resources text[],
  p_forbidden_operations text[],
  p_ephemeral_limits jsonb,
  p_data_flow_bindings jsonb,
  p_required_approvals jsonb,
  p_required_approvals_spec jsonb,
  p_registry_version text,
  p_compiler_version text,
  p_input_hash text,
  p_output_hash text,
  p_verifier_result jsonb,
  p_objective_trace jsonb
)
returns table (contract_id uuid, version integer, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_plan_tenant_id uuid;
  v_existing_id uuid;
  v_existing_version integer;
  v_existing_output_hash text;
  v_new_id uuid;
  v_new_version integer;
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

  select tenant_id into v_plan_tenant_id from public.plans where id = p_plan_id;
  if v_plan_tenant_id is null or v_plan_tenant_id <> v_tenant_id then
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
    v_tenant_id, p_task_id, p_plan_id, v_new_version, 'v1', p_allowed_actions,
    coalesce(p_forbidden_resources, '{}'), coalesce(p_forbidden_operations, '{}'),
    p_ephemeral_limits, 'proposed', p_registry_version, p_compiler_version,
    p_input_hash, p_output_hash, p_data_flow_bindings, p_required_approvals, p_required_approvals_spec
  )
  returning id into v_new_id;

  insert into public.contract_compilations (
    tenant_id, task_id, plan_id, contract_id, registry_version, compiler_version,
    input_hash, output_hash, verifier_result, objective_trace
  ) values (
    v_tenant_id, p_task_id, p_plan_id, v_new_id, p_registry_version, p_compiler_version,
    p_input_hash, p_output_hash, p_verifier_result, p_objective_trace
  );

  return query select v_new_id, v_new_version, true;
end;
$fn$;

revoke all on function public.propose_task_contract(uuid, uuid, jsonb, text[], text[], jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.propose_task_contract(uuid, uuid, jsonb, text[], text[], jsonb, jsonb, jsonb, jsonb, text, text, text, text, jsonb, jsonb) to authenticated;

-- submit_contract_for_approval(): same signature as Part 3A. The body now
-- additionally expands required_approvals_spec into pending approval rows,
-- atomically with the proposed -> awaiting_approval transition. A contract
-- needing zero approvals never needs to be submitted at all — it can
-- activate directly from 'proposed' (see activate_task_contract()).
create or replace function public.submit_contract_for_approval(p_contract_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_task_id uuid;
  v_plan_id uuid;
  v_version integer;
  v_input_hash text;
  v_output_hash text;
  v_registry_version text;
  v_compiler_version text;
  v_required_approvals_spec jsonb;
  v_task_principal_id uuid;
  v_principal_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'submit_contract_for_approval() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id, task_id, plan_id, version, input_hash, output_hash, registry_version,
         compiler_version, required_approvals_spec
    into v_tenant_id, v_task_id, v_plan_id, v_version, v_input_hash, v_output_hash,
         v_registry_version, v_compiler_version, v_required_approvals_spec
  from public.task_authority_contracts where id = p_contract_id;

  if v_tenant_id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;

  if not authz.has_min_role(v_tenant_id, 'developer') then
    raise exception 'insufficient privileges to submit this contract for approval' using errcode = '42501';
  end if;

  select id into v_principal_id
  from public.principals
  where tenant_id = v_tenant_id and user_id = (select auth.uid());

  update public.task_authority_contracts
  set contract_status = 'awaiting_approval', submitted_by_principal_id = v_principal_id, submitted_at = now()
  where id = p_contract_id and contract_status = 'proposed';

  if not found then
    raise exception 'contract is not in a state that can be submitted for approval' using errcode = '23514';
  end if;

  select principal_id into v_task_principal_id from public.tasks where id = v_task_id;

  -- One row per required *slot*, not per tier: a requirement needing N
  -- distinct approvals becomes N independently-satisfiable rows sharing the
  -- same tier, since a single approvals row can only ever record one
  -- principal's decision (see the previous migration's module doc).
  insert into public.approvals (
    tenant_id, task_id, authorization_decision_id, contract_id, contract_version, plan_id,
    input_hash, output_hash, registry_version, compiler_version, required_kind, required_role,
    slot_index, self_approval_allowed, requested_from_principal_id, status, summary
  )
  select
    v_tenant_id, v_task_id, null, p_contract_id, v_version, v_plan_id,
    v_input_hash, v_output_hash, v_registry_version, v_compiler_version,
    (item ->> 'kind')::public.approval_requirement_kind,
    nullif(item ->> 'role', '')::public.tenant_role,
    slot.slot_index,
    coalesce((item ->> 'selfApprovalAllowed')::boolean, false),
    case when item ->> 'kind' = 'task_owner' then v_task_principal_id else null end,
    'pending',
    left(
      coalesce(
        nullif((select string_agg(reason, '; ') from jsonb_array_elements_text(item -> 'reasons') as reason), ''),
        'Approval required.'
      ),
      2000
    )
  from jsonb_array_elements(v_required_approvals_spec -> 'items') as item
  cross join lateral generate_series(0, greatest(coalesce((item ->> 'count')::integer, 1), 1) - 1) as slot(slot_index)
  on conflict (contract_id, required_kind, coalesce(required_role::text, ''), slot_index) where contract_id is not null
    do nothing;
end;
$fn$;

revoke all on function public.submit_contract_for_approval(uuid) from public, anon;
grant execute on function public.submit_contract_for_approval(uuid) to authenticated;

-- decide_contract_approval(): approve or reject one pending contract-bound
-- approval row. "task_owner" rows are satisfied only by the exact principal
-- the task itself is attributed to; "role" rows by any principal at or
-- above the required role, subject to self-approval prevention.
create or replace function public.decide_contract_approval(
  p_approval_id uuid,
  p_decision public.approval_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_contract_id uuid;
  v_required_kind public.approval_requirement_kind;
  v_required_role public.tenant_role;
  v_self_approval_allowed boolean;
  v_requested_from_principal_id uuid;
  v_status public.approval_status;
  v_submitted_by_principal_id uuid;
  v_responder_principal_id uuid;
  v_reason text;
begin
  if (select auth.uid()) is null then
    raise exception 'decide_contract_approval() requires an authenticated caller' using errcode = '28000';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected' using errcode = '22023';
  end if;

  select a.tenant_id, a.contract_id, a.required_kind, a.required_role, a.self_approval_allowed,
         a.requested_from_principal_id, a.status
    into v_tenant_id, v_contract_id, v_required_kind, v_required_role, v_self_approval_allowed,
         v_requested_from_principal_id, v_status
  from public.approvals a
  where a.id = p_approval_id and a.contract_id is not null;

  if v_tenant_id is null then
    raise exception 'contract approval not found' using errcode = 'P0002';
  end if;

  if v_status <> 'pending' then
    raise exception 'this approval has already been decided' using errcode = '23514';
  end if;

  select id into v_responder_principal_id
  from public.principals
  where tenant_id = v_tenant_id and user_id = (select auth.uid());

  if v_required_kind = 'task_owner' then
    if v_responder_principal_id is null or v_responder_principal_id <> v_requested_from_principal_id then
      raise exception 'only the task''s own owner may satisfy this approval' using errcode = '42501';
    end if;
  else
    if not authz.has_min_role(v_tenant_id, v_required_role) then
      raise exception 'insufficient privileges to decide this approval' using errcode = '42501';
    end if;
  end if;

  select submitted_by_principal_id into v_submitted_by_principal_id
  from public.task_authority_contracts where id = v_contract_id;

  if not v_self_approval_allowed and v_responder_principal_id is not null
     and v_responder_principal_id = v_submitted_by_principal_id then
    raise exception 'the principal who submitted this contract may not satisfy this approval' using errcode = '42501';
  end if;

  -- Distinct-approver enforcement for a requirement needing more than one
  -- slot: the same principal cannot fill two slots of the same tier alone.
  -- Only checked for an "approved" decision — a rejection already blocks
  -- the whole tier via activate_task_contract()'s "every slot must be
  -- approved" check, regardless of who made it.
  if p_decision = 'approved' and v_responder_principal_id is not null and exists (
    select 1 from public.approvals a2
    where a2.contract_id = v_contract_id
      and a2.required_kind = v_required_kind
      and a2.required_role is not distinct from v_required_role
      and a2.id <> p_approval_id
      and a2.responded_by_principal_id = v_responder_principal_id
      and a2.status = 'approved'
  ) then
    raise exception 'this principal already approved another slot of this same requirement; a distinct principal is needed for each required approval'
      using errcode = '42501';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_decision = 'rejected' and v_reason is null then
    raise exception 'a rejection reason is required' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 2000 then
    raise exception 'reason exceeds maximum length' using errcode = '22023';
  end if;

  update public.approvals
  set status = p_decision, decided_at = now(), responded_by_principal_id = v_responder_principal_id,
      decision_reason = v_reason
  where id = p_approval_id and status = 'pending';

  if not found then
    raise exception 'this approval has already been decided' using errcode = '23514';
  end if;
end;
$fn$;

revoke all on function public.decide_contract_approval(uuid, public.approval_status, text) from public, anon;
grant execute on function public.decide_contract_approval(uuid, public.approval_status, text) to authenticated;

-- activate_task_contract(): the one path into contract_status = 'active'.
-- Requires admin+ (a strictly higher bar than approving one requirement or
-- rejecting a proposal, both security_admin+) since this is what actually
-- grants runtime authority, however that authority is eventually consumed.
create or replace function public.activate_task_contract(p_contract_id uuid)
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
  v_activator_principal_id uuid;
  v_expires_at timestamptz;
  v_existing_active_id uuid;
  v_item jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'activate_task_contract() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id, task_id, contract_status, ephemeral_limits, required_approvals_spec
    into v_tenant_id, v_task_id, v_status, v_ephemeral_limits, v_required_approvals_spec
  from public.task_authority_contracts
  where id = p_contract_id;

  if v_tenant_id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;

  if not authz.has_min_role(v_tenant_id, 'admin') then
    raise exception 'insufficient privileges to activate this contract' using errcode = '42501';
  end if;

  if v_status not in ('proposed', 'awaiting_approval') then
    raise exception 'contract is not in a state that can be activated' using errcode = '23514';
  end if;

  -- Serializes concurrent activation attempts for this task; the partial
  -- unique index on (task_id) where contract_status = 'active' is the
  -- backstop if this lock were ever bypassed, not the primary mechanism.
  perform pg_advisory_xact_lock(hashtextextended('authority.contract_activation:' || v_task_id::text, 0));

  -- Every row created for this contract is one required slot (see
  -- submit_contract_for_approval()); activation requires every slot of
  -- every tier to be exactly 'approved' — any slot still 'pending' or ever
  -- 'rejected' blocks activation outright, with no way to "outvote" a
  -- rejection in this phase.
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

  select id into v_activator_principal_id
  from public.principals
  where tenant_id = v_tenant_id and user_id = (select auth.uid());

  v_expires_at := now() + make_interval(secs => (v_ephemeral_limits ->> 'expiresInSeconds')::integer);

  if v_existing_active_id is not null then
    update public.task_authority_contracts
    set contract_status = 'superseded', superseded_at = now(), superseded_by_contract_id = p_contract_id
    where id = v_existing_active_id;
  end if;

  update public.task_authority_contracts
  set contract_status = 'active', activated_at = now(), activated_by_principal_id = v_activator_principal_id,
      expires_at = v_expires_at
  where id = p_contract_id and contract_status in ('proposed', 'awaiting_approval');

  if not found then
    raise exception 'contract is not in a state that can be activated' using errcode = '23514';
  end if;
end;
$fn$;

revoke all on function public.activate_task_contract(uuid) from public, anon;
grant execute on function public.activate_task_contract(uuid) to authenticated;

-- revoke_task_contract(): active -> revoked only.
create or replace function public.revoke_task_contract(p_contract_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_principal_id uuid;
  v_reason text;
begin
  if (select auth.uid()) is null then
    raise exception 'revoke_task_contract() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.task_authority_contracts where id = p_contract_id;
  if v_tenant_id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;

  if not authz.has_min_role(v_tenant_id, 'security_admin') then
    raise exception 'insufficient privileges to revoke this contract' using errcode = '42501';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 then
    raise exception 'a revocation reason is required' using errcode = '22023';
  end if;
  if char_length(v_reason) > 2000 then
    raise exception 'revocation reason exceeds maximum length' using errcode = '22023';
  end if;

  select id into v_principal_id
  from public.principals
  where tenant_id = v_tenant_id and user_id = (select auth.uid());

  update public.task_authority_contracts
  set contract_status = 'revoked', revoked_at = now(), revoked_by_principal_id = v_principal_id,
      revocation_reason = v_reason
  where id = p_contract_id and contract_status = 'active';

  if not found then
    raise exception 'contract is not in a state that can be revoked' using errcode = '23514';
  end if;
end;
$fn$;

revoke all on function public.revoke_task_contract(uuid, text) from public, anon;
grant execute on function public.revoke_task_contract(uuid, text) to authenticated;

-- reconcile_expired_contracts(): belt, not suspenders. A future runtime
-- consumption path must never rely on this having run — see
-- authz.contract_is_currently_active() above, which is what any real check
-- must call instead of trusting contract_status alone. This RPC only
-- exists so *something* can proactively flip the visible status for
-- display/audit purposes; scoped to tenants the caller belongs to, since it
-- has no other authorization model of its own.
create or replace function public.reconcile_expired_contracts()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'reconcile_expired_contracts() requires an authenticated caller' using errcode = '28000';
  end if;

  with expired as (
    update public.task_authority_contracts tac
    set contract_status = 'expired'
    where tac.contract_status = 'active'
      and tac.expires_at is not null
      and tac.expires_at < now()
      and authz.has_min_role(tac.tenant_id, 'developer')
    returning 1
  )
  select count(*) into v_count from expired;

  return v_count;
end;
$fn$;

revoke all on function public.reconcile_expired_contracts() from public, anon;
grant execute on function public.reconcile_expired_contracts() to authenticated;
