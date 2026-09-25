-- Part 3A: propose_task_contract(), submit_contract_for_approval(), reject_contract().
--
-- The server-side TypeScript pipeline (registry -> plan-validator -> solver
-- -> contract-compiler -> contract-verifier, all server-only) remains
-- entirely responsible for deciding what the compiled contract's content
-- and verifier_result *should* be. These RPCs independently enforce only
-- persistence, tenancy and lifecycle invariants — they do not re-run the
-- solver, cannot verify that a specific TypeScript process produced their
-- arguments, and none of them ever write contract_status = 'active'. A
-- direct client call with hand-crafted arguments is exactly why a
-- 'proposed' row grants zero runtime authority regardless of what it
-- claims — see contract-verifier.ts's module doc.
--
-- propose_task_contract() deliberately does NOT branch on
-- p_verifier_result's own claimed "ok" value — checking it would be
-- security theater, not a guarantee: a caller bypassing the real TypeScript
-- pipeline could set it to whatever it wants just as easily as any other
-- argument. verifier_result is stored purely as audit evidence.

create or replace function public.propose_task_contract(
  p_task_id uuid,
  p_plan_id uuid,
  p_allowed_actions jsonb,
  p_forbidden_resources text[],
  p_forbidden_operations text[],
  p_ephemeral_limits jsonb,
  p_data_flow_bindings jsonb,
  p_required_approvals jsonb,
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

  -- Serializes concurrent proposals for this task so version allocation and
  -- the compilation-identity check below cannot race.
  perform pg_advisory_xact_lock(hashtextextended('authority.contract_version:' || p_task_id::text, 0));

  -- Compilation identity: (task_id, plan_id, registry_version,
  -- compiler_version, input_hash). A different compiler_version is a
  -- different identity by construction, never deduplicated against a prior
  -- compilation.
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
    -- Same complete identity, different output: the compiler is supposed to
    -- be deterministic for a pinned registry/compiler version, so this is a
    -- correctness bug, not a legitimate retry. Surfaced loudly rather than
    -- silently returning either the old or the new row.
    raise exception 'deterministic compiler invariant violated: identical compilation identity (task, plan, registry version, compiler version, input hash) produced a different output hash'
      using errcode = '55000';
  end if;

  select coalesce(max(tac.version), 0) + 1 into v_new_version
  from public.task_authority_contracts tac
  where tac.task_id = p_task_id;

  insert into public.task_authority_contracts (
    tenant_id, task_id, plan_id, version, spec_version, allowed_actions, forbidden_resources,
    forbidden_operations, ephemeral_limits, contract_status, registry_version, compiler_version,
    input_hash, output_hash, data_flow_bindings, required_approvals
  ) values (
    v_tenant_id, p_task_id, p_plan_id, v_new_version, 'v1', p_allowed_actions,
    coalesce(p_forbidden_resources, '{}'), coalesce(p_forbidden_operations, '{}'),
    p_ephemeral_limits, 'proposed', p_registry_version, p_compiler_version,
    p_input_hash, p_output_hash, p_data_flow_bindings, p_required_approvals
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

revoke all on function public.propose_task_contract(uuid, uuid, jsonb, text[], text[], jsonb, jsonb, jsonb, text, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.propose_task_contract(uuid, uuid, jsonb, text[], text[], jsonb, jsonb, jsonb, text, text, text, text, jsonb, jsonb) to authenticated;

-- submit_contract_for_approval(): proposed -> awaiting_approval only.
-- Derives the acting principal from auth.uid() and the contract's own
-- tenant — never accepted from the caller. If this user has no principal
-- record in this tenant, the call fails explicitly rather than recording an
-- unattributed governance action (see the design review on audit identity).
create or replace function public.submit_contract_for_approval(p_contract_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_principal_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'submit_contract_for_approval() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.task_authority_contracts where id = p_contract_id;
  if v_tenant_id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;

  if not authz.has_min_role(v_tenant_id, 'developer') then
    raise exception 'insufficient privileges to submit this contract for approval' using errcode = '42501';
  end if;

  select id into v_principal_id
  from public.principals
  where tenant_id = v_tenant_id and user_id = (select auth.uid());

  if v_principal_id is null then
    raise exception 'no principal record exists for this user in this tenant; a principal is required to record who submitted this contract'
      using errcode = 'P0002';
  end if;

  update public.task_authority_contracts
  set contract_status = 'awaiting_approval', submitted_by_principal_id = v_principal_id, submitted_at = now()
  where id = p_contract_id and contract_status = 'proposed';

  if not found then
    raise exception 'contract is not in a state that can be submitted for approval' using errcode = '23514';
  end if;
end;
$fn$;

revoke all on function public.submit_contract_for_approval(uuid) from public, anon;
grant execute on function public.submit_contract_for_approval(uuid) to authenticated;

-- reject_contract(): {proposed, awaiting_approval} -> rejected only. Cannot
-- modify compiled contract content — enforced independently by the trigger
-- regardless of this function's own care in only ever setting lifecycle
-- columns. Rejecting a contract that has already been formally submitted
-- for approval requires security_admin+ (matching the bar for resolving an
-- approval elsewhere in this schema); rejecting an as-yet-unsubmitted
-- proposal only requires developer+, since that is still an informal,
-- iterative step.
create or replace function public.reject_contract(p_contract_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_status public.contract_status;
  v_principal_id uuid;
  v_reason text;
begin
  if (select auth.uid()) is null then
    raise exception 'reject_contract() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id, contract_status into v_tenant_id, v_status
  from public.task_authority_contracts where id = p_contract_id;
  if v_tenant_id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;

  if v_status = 'awaiting_approval' then
    if not authz.has_min_role(v_tenant_id, 'security_admin') then
      raise exception 'insufficient privileges to reject a contract awaiting approval' using errcode = '42501';
    end if;
  else
    if not authz.has_min_role(v_tenant_id, 'developer') then
      raise exception 'insufficient privileges to reject this contract' using errcode = '42501';
    end if;
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 then
    raise exception 'a rejection reason is required' using errcode = '22023';
  end if;
  if char_length(v_reason) > 2000 then
    raise exception 'rejection reason exceeds maximum length' using errcode = '22023';
  end if;

  select id into v_principal_id
  from public.principals
  where tenant_id = v_tenant_id and user_id = (select auth.uid());

  if v_principal_id is null then
    raise exception 'no principal record exists for this user in this tenant; a principal is required to record who rejected this contract'
      using errcode = 'P0002';
  end if;

  update public.task_authority_contracts
  set contract_status = 'rejected', rejected_by_principal_id = v_principal_id, rejected_at = now(), rejection_reason = v_reason
  where id = p_contract_id and contract_status in ('proposed', 'awaiting_approval');

  if not found then
    raise exception 'contract is not in a state that can be rejected' using errcode = '23514';
  end if;
end;
$fn$;

revoke all on function public.reject_contract(uuid, text) from public, anon;
grant execute on function public.reject_contract(uuid, text) to authenticated;
