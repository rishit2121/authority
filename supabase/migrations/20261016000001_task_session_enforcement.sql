-- Task isolation that does not depend on any AI review setting, and an
-- alignment activation gate bound to the exact plan rather than a contract row.
--
-- 1. applications.require_task_sessions: when true, a raw agent runtime key
--    (authority_rk_...) is refused for every task of that application -- an
--    agent must open a task session (bound to one task) instead. A runtime key
--    is agent-scoped, so without this an agent serving several customers could
--    act on another customer's task. Turning task alignment on or off never
--    changes this setting.
--
--    Migration path: existing applications keep today's behavior (false) until
--    an administrator switches it on (Settings -> Applications -> Require task
--    sessions) after moving their agent to sessions. Applications created from
--    now on start with it on.
--
-- 2. gateway.contract_alignment_cleared now matches the plan review by the
--    compiled plan's input hash: a re-prepared identical plan gets a new
--    contract row, and a person's approval of that exact plan must still count
--    (found by the integration suite). Nothing else about the gate changes.

alter table public.applications add column require_task_sessions boolean not null default false;
alter table public.applications alter column require_task_sessions set default true;

comment on column public.applications.require_task_sessions is
  'When true, raw agent runtime keys are refused for this application''s tasks; agents must use task sessions. Independent of task alignment.';

-- 'ok' or 'session_required', for the credential about to act on this task.
create or replace function gateway.task_credential_policy(p_secret text, p_task_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when left(coalesce(p_secret, ''), 13) = 'authority_rk_' and exists (
      select 1 from public.tasks t
      join public.customers c on c.id = t.customer_id
      join public.applications a on a.id = c.application_id
      where t.id = p_task_id and a.require_task_sessions
    ) then 'session_required'
    else 'ok'
  end;
$$;
revoke all on function gateway.task_credential_policy(text, uuid) from public;
grant execute on function gateway.task_credential_policy(text, uuid) to authority_gateway;

-- Alignment endpoints honor the same rule (in addition to their own enforce-mode rule).
create or replace function gateway.alignment_auth(p_secret text, p_task_id uuid)
returns table (aa_status text, aa_tenant_id uuid, aa_application_id uuid, aa_credential_kind text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid; v_agent uuid; v_cred uuid;
  v_task_tenant uuid; v_task_agent uuid; v_task_app uuid; v_session_task uuid;
begin
  select t.tenant_id, t.agent_id, c.application_id into v_task_tenant, v_task_agent, v_task_app
  from public.tasks t left join public.customers c on c.id = t.customer_id
  where t.id = p_task_id;

  if left(coalesce(p_secret, ''), 13) = 'authority_dk_' then
    select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
    from gateway.resolve_backend_credential(p_secret);
    if v_status <> 'ok' then return query select v_status, null::uuid, null::uuid, null::text; return; end if;
    if v_task_tenant is null or v_task_tenant <> v_tenant or v_task_app is distinct from v_app then
      return query select 'task_not_found'::text, null::uuid, null::uuid, null::text; return;
    end if;
    return query select 'ok'::text, v_tenant, v_app, 'backend'::text; return;
  end if;

  select rc_status, rc_tenant_id, rc_agent_id, rc_credential_id into v_status, v_tenant, v_agent, v_cred
  from gateway.resolve_credential(p_secret);
  if v_status <> 'ok' then return query select v_status, null::uuid, null::uuid, null::text; return; end if;
  if v_task_tenant is null or v_task_tenant <> v_tenant then
    return query select 'task_not_found'::text, null::uuid, null::uuid, null::text; return;
  end if;
  if left(p_secret, 13) = 'authority_ts_' then
    select ts.task_id into v_session_task from public.task_sessions ts
    where ts.token_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex');
    if v_session_task is distinct from p_task_id then
      return query select 'session_task_mismatch'::text, null::uuid, null::uuid, null::text; return;
    end if;
  end if;
  if v_task_agent is distinct from v_agent then
    return query select 'agent_mismatch'::text, null::uuid, null::uuid, null::text; return;
  end if;
  if gateway.task_credential_policy(p_secret, p_task_id) <> 'ok' then
    return query select 'session_required'::text, null::uuid, null::uuid, null::text; return;
  end if;
  return query select 'ok'::text, v_tenant, v_task_app,
    case when left(p_secret, 13) = 'authority_ts_' then 'session' else 'runtime_key' end;
end;
$fn$;
revoke all on function gateway.alignment_auth(text, uuid) from public;
grant execute on function gateway.alignment_auth(text, uuid) to authority_gateway;

create or replace function public.set_application_require_task_sessions(p_application_id uuid, p_required boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_tenant uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'set_application_require_task_sessions() requires an authenticated caller' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.applications where id = p_application_id;
  if v_tenant is null or not authz.is_member_of(v_tenant) then return 'not_found'; end if;
  if not authz.has_min_role(v_tenant, 'security_admin') then return 'forbidden'; end if;
  update public.applications set require_task_sessions = coalesce(p_required, false) where id = p_application_id;
  return 'ok';
end;
$fn$;
revoke all on function public.set_application_require_task_sessions(uuid, boolean) from public, anon;
grant execute on function public.set_application_require_task_sessions(uuid, boolean) to authenticated;

-- 2. The activation gate, bound to the compiled plan's input hash.
create or replace function gateway.contract_alignment_cleared(p_contract_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_task uuid; v_hash text; v_mode text; v_plans boolean; v_obj integer;
begin
  select tac.task_id, tac.input_hash, s.mode, s.check_plans into v_task, v_hash, v_mode, v_plans
  from public.task_authority_contracts tac
  join public.tasks t on t.id = tac.task_id
  left join public.customers c on c.id = t.customer_id
  left join public.alignment_settings s on s.application_id = c.application_id
  where tac.id = p_contract_id;
  if coalesce(v_mode, 'off') <> 'enforce' or not coalesce(v_plans, true) then return true; end if;
  select objective_version into v_obj from public.task_alignment_state where task_id = v_task;
  -- The newest review of this exact plan under the current objectives decides.
  return coalesce((
    select (r.outcome = 'aligned' or r.decision = 'approved') and r.decision is distinct from 'rejected'
    from public.alignment_reviews r
    where r.task_id = v_task and r.kind = 'plan' and r.mode = 'enforce'
      and r.subject_hash = v_hash and r.objective_version = coalesce(v_obj, 0)
    order by (r.decision is not null) desc, r.created_at desc
    limit 1
  ), false);
end;
$fn$;
revoke all on function gateway.contract_alignment_cleared(uuid) from public;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261016000001'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
