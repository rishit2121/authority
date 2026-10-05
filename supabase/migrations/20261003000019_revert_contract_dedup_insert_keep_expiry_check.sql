-- Partial revert of 20261003000018, found via live verification against
-- the deployed service immediately after that migration shipped:
-- `gateway.propose_task_contract_core`'s change there -- falling through to
-- INSERT a fresh contract row when the matched existing one was no longer
-- currently-active -- collides with `tac_compilation_identity_idx`
-- (20260925000004_contract_lifecycle_columns_and_trigger.sql), a unique
-- index on (task_id, plan_id, registry_version, compiler_version,
-- input_hash) with NO predicate on contract_status or expires_at. That
-- index is a deliberate, permanent one-row-forever mapping for a given
-- compiled identity (see the function's own "deterministic compiler
-- invariant violated" exception just below the lookup) -- it does not
-- distinguish a live row from a dead one, so a second INSERT with the same
-- identity always raises 23505 unique_violation, regardless of the first
-- row's status. This surfaced live as every `prepare()` call on an
-- already-expired contract failing with 503 GATEWAY_UNAVAILABLE instead of
-- reporting any outcome at all -- strictly worse than the mis-reporting bug
-- 20261003000018 set out to fix.
--
-- Reverting `propose_task_contract_core` to its original (20261003000014)
-- body: unconditional reuse of the existing row by compilation identity,
-- regardless of status. This repository's data model does not support
-- minting a second contract row for an identical (task, plan, registry
-- version, compiler version, input hash) tuple -- doing so correctly would
-- need a schema change (e.g. scoping the unique index to only
-- currently-live statuses, plus an explicit old-row-superseding step), which
-- is out of scope for this hotfix.
--
-- `gateway.activate_task_contract_for_backend`'s fix from 20261003000018 is
-- KEPT as is -- it only changed a status check, never touches this INSERT
-- path, and does not conflict with the index. The practical, honest result
-- for an already-expired contract is therefore: `propose_task_contract_core`
-- still hands back the same (dead) contract id, but
-- `activate_task_contract_for_backend` no longer short-circuits it to a
-- false "ok" -- activation is attempted, `activate_task_contract_core`
-- raises because the row is not in ('proposed', 'awaiting_approval'), and
-- `prepareTask()` reports `awaiting_approval` (not `ready`) with that same
-- contractId. That status label is imperfect for "this is simply expired,
-- not actually pending a human decision" -- a dedicated outcome for that is
-- a real future improvement, but prepare() no longer LIES about readiness,
-- which is the security-relevant property. Getting a genuinely fresh,
-- usable contract for the same logical intent today requires a new task
-- (and therefore a new plan_id), which already works with no schema change.

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

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000019'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
