-- Fixes a real inconsistency found live while e2e-testing the new
-- application-shared access-management panel: gateway.connection_usable_by_customer
-- (20261003000021) was extended to recognize an `application_shared` policy,
-- so a customer genuinely CAN bind a task to such a connection -- but
-- gateway.list_customer_connections (what `GET
-- /api/v1/customers/{id}/connections` actually calls) is a separate
-- function that was never updated, so that connection never appeared in
-- the list at all. A caller doing exactly what the SDK's own task-lifecycle
-- docs recommend -- list a customer's usable connections, then bind one --
-- would never see it, even though binding it directly would have worked.
--
-- Strictly additive: the `matches` CTE's WHERE clause gains one more `or`
-- branch, mirroring connection_usable_by_customer's own application_shared
-- check exactly. The two pre-existing branches (customer-owned,
-- organization-owned-with-delegation) are untouched, so nothing a customer
-- could already see is affected.
create or replace function gateway.list_customer_connections(p_secret text, p_customer_id uuid)
returns table (
  lcc_status text, lcc_connection_id uuid, lcc_connector_id text, lcc_status_value text,
  lcc_owner_kind text, lcc_verified_account_ref text, lcc_created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid;
  v_customer_app uuid;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::text, null::text, null::text, null::text, null::timestamptz; return;
  end if;

  select application_id into v_customer_app from public.customers
  where id = p_customer_id and tenant_id = v_tenant;
  if v_customer_app is null or v_customer_app <> v_app then
    return query select 'customer_not_found'::text, null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  return query
    with matches as (
      select cc.id, cc.connector_id, cc.status::text as status_value, cc.owner_kind,
             cc.verified_account_ref, cc.created_at
      from public.connector_connections cc
      where cc.tenant_id = v_tenant and cc.status <> 'disconnected'
        and (
          (cc.owner_kind = 'customer' and cc.owner_customer_id = p_customer_id)
          or (cc.owner_kind = 'organization' and exists (
            select 1 from public.connection_delegations cd
            where cd.connection_id = cc.id and cd.customer_id = p_customer_id and cd.revoked_at is null
          ))
          or (cc.owner_kind = 'organization' and exists (
            select 1 from public.application_connection_access_policies p
            where p.connection_id = cc.id and p.application_id = v_app and p.scope = 'application_shared'
          ))
        )
    )
    select 'ok'::text, m.id, m.connector_id, m.status_value, m.owner_kind, m.verified_account_ref, m.created_at
    from matches m
    union all
    select 'ok'::text, null::uuid, null::text, null::text, null::text, null::text, null::timestamptz
    where not exists (select 1 from matches)
    order by 7 desc nulls last;
end;
$fn$;
revoke all on function gateway.list_customer_connections(text, uuid) from public;
grant execute on function gateway.list_customer_connections(text, uuid) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000022'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
