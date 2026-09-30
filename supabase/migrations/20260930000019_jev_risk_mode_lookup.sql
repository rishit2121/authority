-- A single, narrow, side-effect-free, gateway-role-only lookup the runtime pipeline needs before deciding whether to
-- run shadow-mode Jev risk evaluation for a request. Resolves tenant from the task id (already part of
-- `AuthorizeInput` — never a caller-supplied tenant id), a plain read with none of the rate-limiting/auth-event/
-- last-used-at side effects `gateway.resolve_credential` has, so this can be called once per request in addition to
-- (not instead of) the credential resolution `prepare_authorization`/`commit_authorization` already do internally,
-- without double-counting anything. Deliberately NOT folded into `gateway.prepare_authorization` (a much larger,
-- heavily-tested function this migration avoids touching at all).
create or replace function gateway.jev_risk_mode_for_task(p_task_id uuid)
returns table (jc_tenant_id uuid, jc_risk_mode text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.tenant_id, coalesce((select js.risk_mode from public.jev_settings js where js.tenant_id = t.tenant_id), 'off')
  from public.tasks t
  where t.id = p_task_id;
$$;
revoke all on function gateway.jev_risk_mode_for_task(uuid) from public;
grant execute on function gateway.jev_risk_mode_for_task(uuid) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20260930000019'::text $$;
