-- External-content screening is an opt-in addition, with report-only or
-- quarantine behavior.
--
-- * check_content now defaults to false for NEW alignment settings rows:
--   plan and action alignment never depend on an application submitting its
--   external content, and existing clients need no integration. Existing rows
--   keep their stored values.
-- * content_action: 'report' (inspect and attach findings, never withhold) or
--   'quarantine' (withhold content that is flagged, held or not reviewed).
--   Shadow mode always reports.
-- * alignment_context returns content_action so every path applies the same rule.
--
-- Task-session enforcement (applications.require_task_sessions) is untouched
-- and independent of all of these settings.

alter table public.alignment_settings
  add column content_action text not null default 'report' check (content_action in ('report', 'quarantine'));
alter table public.alignment_settings alter column check_content set default false;

drop function if exists gateway.alignment_context(text, uuid);
create function gateway.alignment_context(p_secret text, p_task_id uuid)
returns table (
  ac_status text, ac_credential_kind text, ac_tenant_id uuid, ac_application_id uuid,
  ac_mode text, ac_policy text, ac_max_content_bytes integer,
  ac_objective_version integer, ac_context_revision integer,
  ac_task_intent text, ac_objective_request text, ac_objective_extraction jsonb, ac_objective_status text,
  ac_contract_id uuid, ac_allowed_actions jsonb,
  ac_check_plans boolean, ac_check_content boolean, ac_check_actions boolean,
  ac_plan_outcome text, ac_plan_decision text, ac_content_action text
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid; v_kind text;
  v_mode text; v_policy text; v_max integer; v_action text;
  v_plans boolean := true; v_content boolean := false; v_actions boolean := true;
  v_obj_version integer := 0; v_ctx integer := 0;
  v_intent text; v_req text; v_ext jsonb; v_obj_status text;
  v_contract uuid; v_contract_hash text; v_actions_json jsonb; v_plan_outcome text; v_plan_decision text;
begin
  select aa_status, aa_tenant_id, aa_application_id, aa_credential_kind into v_status, v_tenant, v_app, v_kind
  from gateway.alignment_auth(p_secret, p_task_id);
  if v_status <> 'ok' then
    return query select v_status, null::text, null::uuid, null::uuid, null::text, null::text, null::integer,
      null::integer, null::integer, null::text, null::text, null::jsonb, null::text, null::uuid, null::jsonb,
      null::boolean, null::boolean, null::boolean, null::text, null::text, null::text;
    return;
  end if;

  if v_app is not null then
    select s.mode, s.policy, s.max_content_bytes, s.check_plans, s.check_content, s.check_actions, s.content_action
      into v_mode, v_policy, v_max, v_plans, v_content, v_actions, v_action
    from public.alignment_settings s where s.application_id = v_app;
  end if;
  v_mode := coalesce(v_mode, 'off'); v_policy := coalesce(v_policy, 'production'); v_max := coalesce(v_max, 32768);
  v_plans := coalesce(v_plans, true); v_content := coalesce(v_content, false); v_actions := coalesce(v_actions, true);
  v_action := coalesce(v_action, 'report');

  select t.intent into v_intent from public.tasks t where t.id = p_task_id;
  select st.objective_version, st.context_revision into v_obj_version, v_ctx
  from public.task_alignment_state st where st.task_id = p_task_id;
  v_obj_version := coalesce(v_obj_version, 0); v_ctx := coalesce(v_ctx, 0);
  if v_obj_version > 0 then
    select o.request_text, o.extraction, o.status into v_req, v_ext, v_obj_status
    from public.task_objectives o where o.task_id = p_task_id and o.version = v_obj_version;
  end if;

  select tac.id, tac.allowed_actions, tac.input_hash into v_contract, v_actions_json, v_contract_hash
  from public.task_authority_contracts tac
  where tac.task_id = p_task_id and authz.contract_is_currently_active(tac.contract_status, tac.expires_at)
  limit 1;

  -- The plan review of exactly the active contract's plan (by input hash), under the current objectives.
  if v_contract is not null and v_obj_version > 0 then
    select r.outcome, r.decision into v_plan_outcome, v_plan_decision
    from public.alignment_reviews r
    where r.task_id = p_task_id and r.kind = 'plan' and r.subject_hash = v_contract_hash and r.objective_version = v_obj_version
    order by (r.decision is not null) desc, r.created_at desc limit 1;
  end if;

  return query select 'ok'::text, v_kind, v_tenant, v_app, v_mode, v_policy, v_max, v_obj_version, v_ctx,
    v_intent, v_req, v_ext, v_obj_status, v_contract, v_actions_json, v_plans, v_content, v_actions,
    v_plan_outcome, v_plan_decision, v_action;
end;
$fn$;
revoke all on function gateway.alignment_context(text, uuid) from public;
grant execute on function gateway.alignment_context(text, uuid) to authority_gateway;

create or replace function public.set_alignment_content_screening(p_application_id uuid, p_enabled boolean, p_action text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_tenant uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'set_alignment_content_screening() requires an authenticated caller' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.applications where id = p_application_id;
  if v_tenant is null or not authz.is_member_of(v_tenant) then return 'not_found'; end if;
  if not authz.has_min_role(v_tenant, 'security_admin') then return 'forbidden'; end if;
  if p_action not in ('report', 'quarantine') then return 'invalid_request'; end if;
  insert into public.alignment_settings (application_id, tenant_id, check_content, content_action, updated_by, updated_at)
  values (p_application_id, v_tenant, coalesce(p_enabled, false), p_action, (select auth.uid()), now())
  on conflict (application_id) do update
    set check_content = excluded.check_content, content_action = excluded.content_action,
        updated_by = excluded.updated_by, updated_at = now();
  return 'ok';
end;
$fn$;
revoke all on function public.set_alignment_content_screening(uuid, boolean, text) from public, anon;
grant execute on function public.set_alignment_content_screening(uuid, boolean, text) to authenticated;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261016000002'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
