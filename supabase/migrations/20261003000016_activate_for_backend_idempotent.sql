-- Fixes a real bug found during live verification of the model-driven-agent
-- example: calling gateway.activate_task_contract_for_backend a second time
-- on a contract that activated successfully the first time returned
-- 'not_eligible' instead of 'ok'. activate_task_contract_core() raises when
-- asked to activate a contract that is not in ('proposed', 'awaiting_approval')
-- -- including one that is already 'active' -- and the backend wrapper's
-- blanket `exception when others then return 'not_eligible'` could not tell
-- that apart from a genuinely-ineligible contract. prepareTask() then
-- reported a perfectly ready, already-running task as `awaiting_approval`
-- on a redundant prepare() call -- a mis-reporting bug, never a security
-- issue (it only ever under-reports readiness, never grants anything a
-- fresh eligibility check wouldn't have).
--
-- Fixed by checking the contract's current status before attempting
-- activation at all: already 'active' returns 'ok' immediately (the
-- idempotent, correct answer -- nothing to do), and every other status
-- still runs the exact same eligibility checks as before.
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
  v_tools text[];
  v_approvals_count integer;
  v_missing_policy boolean;
  v_activator_principal_id uuid;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then return v_status; end if;

  select tenant_id, task_id, contract_status into v_contract_tenant, v_task_id, v_contract_status
  from public.task_authority_contracts where id = p_contract_id;
  if v_contract_tenant is null or v_contract_tenant <> v_tenant then
    return 'not_found';
  end if;

  select customer_id into v_task_customer from public.tasks where id = v_task_id;
  if v_task_customer is null then return 'not_found'; end if;
  select application_id into v_customer_app from public.customers where id = v_task_customer;
  if v_customer_app is null or v_customer_app <> v_app then return 'not_found'; end if;

  -- Idempotent short-circuit: already active is success, not a fresh
  -- eligibility question -- re-preparing an already-ready task must report
  -- "ready" again, never regress to "awaiting_approval".
  if v_contract_status = 'active' then
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
    -- backend-API function in this schema. The already-active case is
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
as $$ select '20261003000016'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
