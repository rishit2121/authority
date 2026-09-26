-- Part 4 corrective, found while writing authorize_tool_call()'s pgTAP
-- suite: no RPC in this codebase ever moved a real (non-demo) task out of
-- 'pending' — only the demo installer inserts tasks with 'executing' already
-- set. authorize_tool_call() requires a task to be 'contract_issued' or
-- 'executing' before it will evaluate anything, which is correct, but with
-- nothing to ever set either status, no real task could ever pass that
-- check. Contract activation is the one event that actually grants a task
-- runtime authority for the first time, so it is the natural, single place
-- to make this transition — same signature, same authorization and
-- approval checks as the original, with one added update at the end.
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

  -- New: grant the task runtime authority for the first time. Never
  -- downgrades a task already past 'pending' (e.g. re-activating after a
  -- later version was proposed for an already-executing task).
  update public.tasks
  set status = 'contract_issued', updated_at = now()
  where id = v_task_id and status = 'pending';
end;
$fn$;
