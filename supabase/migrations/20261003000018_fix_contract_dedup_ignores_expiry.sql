-- Fixes a real bug found during live verification of the model-driven-agent
-- example against the deployed service: a task's contract was activated
-- successfully earlier, its ephemeral window later expired (as designed),
-- but `prepare()` on the exact same plan kept reporting `status: "ready"`
-- with that same, now-unusable contract -- runtime `execute()` then
-- immediately rejected it ("The task's contract has expired."). `prepare()`
-- and `execute()` disagreeing about whether a contract is usable is a
-- mis-reporting bug, not a security issue (it only ever under-delivers --
-- nothing was granted that the real `execute()`-time check didn't already
-- block) -- but it defeats the entire point of idempotent re-preparation for
-- any long-lived or reused task.
--
-- Root cause, two layers:
--
-- 1. `gateway.propose_task_contract_core`'s own dedup -- keyed on
--    (task_id, plan_id, registry_version, compiler_version, input_hash),
--    not on the caller's idempotency key -- looked up an existing contract
--    row with no filter on its `contract_status`/`expires_at` at all, so it
--    just as happily "reused" an expired, revoked, or rejected contract as a
--    genuinely-fresh `proposed`/`awaiting_approval` or still-active one.
--    Fixed by only treating a found row as reusable when it is still a live
--    proposal (`proposed`/`awaiting_approval`) or still currently active per
--    `authz.contract_is_currently_active` (status AND expiry together,
--    exactly the same predicate the real runtime `execute()` path uses) --
--    anything else (expired, revoked, rejected, superseded) now falls
--    through to minting a fresh version, the same as if nothing existed yet.
--
-- 2. `gateway.activate_task_contract_for_backend` (20261003000016)'s own
--    idempotent short-circuit checked only `contract_status = 'active'`,
--    never `expires_at` -- directly contradicting the invariant stated in
--    20260926000006's own comment: "`contract_status = 'active'` must never
--    become, by itself, sufficient runtime authority for anything built
--    later ... independently re-verify ... status and expiration, every
--    time." Fixed to use `authz.contract_is_currently_active` here too, for
--    defense in depth -- (1) above means this function should no longer
--    ever actually be handed a stale contract id by the backend prepare
--    flow, but this function must not rely on that being true forever.
--
-- Neither change grants anything new: both only stop treating a dead
-- contract as equivalent to a live one, and fall through to the exact same
-- fresh-compilation/eligibility path a first-time prepare() already uses.

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
  v_existing_status public.contract_status;
  v_existing_expires_at timestamptz;
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

  select tac.id, tac.version, tac.output_hash, tac.contract_status, tac.expires_at
    into v_existing_id, v_existing_version, v_existing_output_hash, v_existing_status, v_existing_expires_at
  from public.task_authority_contracts tac
  where tac.task_id = p_task_id
    and tac.plan_id = p_plan_id
    and tac.registry_version = p_registry_version
    and tac.compiler_version = p_compiler_version
    and tac.input_hash = p_input_hash
    and tac.demo_key is null
  order by tac.version desc
  limit 1;

  if v_existing_id is not null
     and (v_existing_status in ('proposed', 'awaiting_approval')
          or authz.contract_is_currently_active(v_existing_status, v_existing_expires_at)) then
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

create or replace function gateway.activate_task_contract_for_backend(p_secret text, p_contract_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid;
  v_contract_tenant uuid; v_task_id uuid; v_task_customer uuid; v_customer_app uuid;
  v_contract_status public.contract_status;
  v_expires_at timestamptz;
  v_tools text[];
  v_approvals_count integer;
  v_missing_policy boolean;
  v_activator_principal_id uuid;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then return v_status; end if;

  select tenant_id, task_id, contract_status, expires_at
    into v_contract_tenant, v_task_id, v_contract_status, v_expires_at
  from public.task_authority_contracts where id = p_contract_id;
  if v_contract_tenant is null or v_contract_tenant <> v_tenant then
    return 'not_found';
  end if;

  select customer_id into v_task_customer from public.tasks where id = v_task_id;
  if v_task_customer is null then return 'not_found'; end if;
  select application_id into v_customer_app from public.customers where id = v_task_customer;
  if v_customer_app is null or v_customer_app <> v_app then return 'not_found'; end if;

  -- Idempotent short-circuit: still-active (and not expired) is success,
  -- not a fresh eligibility question. Checked via the same
  -- authz.contract_is_currently_active predicate the real runtime execute
  -- path uses, never contract_status alone -- an active-but-expired
  -- contract must fall through to the exception below, never be reported
  -- "ok" again.
  if authz.contract_is_currently_active(v_contract_status, v_expires_at) then
    return 'ok';
  end if;

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
    -- (e.g. lost a race to a concurrent activation) -- surfaced as a plain
    -- status rather than an exception, consistent with every other
    -- backend-API function in this schema. The still-active case is
    -- handled above and never reaches here.
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
as $$ select '20261003000018'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
