-- Fixes a real bug found during a live (non-fixture) end-to-end run against
-- a real tenant: gateway.list_active_policies_for_backend's success branch
-- was a bare set-returning query with NO row at all when a tenant simply
-- has zero policies configured -- the normal, common state for any new or
-- simple tenant, not an error. Exactly the same bug class already fixed
-- once for gateway.list_customer_connections
-- (20261003000013_fix_list_customer_connections_empty_result.sql), now
-- found in this migration's own sibling function.
--
-- prepareTask()'s TS wrapper reads `rows[0]?.lap_status ?? "unknown"` --
-- with zero rows, that's "unknown", a status developerApiFailureContract
-- doesn't recognize, so it fell through to the generic default: HTTP 400
-- "The request could not be completed." for a call that should have let
-- tasks.prepare() proceed with an empty policy list, exactly as it
-- correctly does on every test tenant that happens to have at least one
-- seeded policy (which is why this was missed until a real, policy-free
-- tenant exercised it).
--
-- Fixed the same way as before: guarantee the 'ok' status is emitted as
-- its own row when no policy rows exist. The WHERE clause that decides
-- which policies are returned is unchanged.
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
    with matches as (
      select p.id, p.name, p.description, p.version, p.status::text as status_value, p.effect::text,
        p.conditions, p.required_approval_role::text, p.required_approval_count, p.created_at, p.activated_at
      from public.policies p
      where p.tenant_id = v_tenant
    )
    select 'ok'::text, m.id, m.name, m.description, m.version, m.status_value, m.effect, m.conditions,
      m.required_approval_role, m.required_approval_count, m.created_at, m.activated_at
    from matches m
    union all
    select 'ok'::text, null::uuid, null::text, null::text, null::integer, null::text, null::text,
      null::jsonb, null::text, null::integer, null::timestamptz, null::timestamptz
    where not exists (select 1 from matches)
    order by 3 asc nulls last, 5 desc nulls last;
end;
$fn$;
revoke all on function gateway.list_active_policies_for_backend(text) from public;
grant execute on function gateway.list_active_policies_for_backend(text) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000017'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
