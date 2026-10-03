-- Fixes a real bug found during a live (non-fixture) end-to-end run:
-- gateway.list_customer_connections' success branch was
--   return query select 'ok'::text, cc.id, ... from public.connector_connections cc where <scoped to this customer>;
-- a set-returning query with NO row at all when a legitimate, correctly-
-- scoped customer simply has zero usable connections right now -- not an
-- error, the normal state for a customer who hasn't connected anything
-- yet (Bob, before he connects; any customer right after being created).
--
-- The TS wrapper (rpc-customers.ts's listCustomerConnections) reads
-- `rows[0]?.lcc_status ?? "unknown"` -- with zero rows, that's "unknown",
-- a status gateway/response.ts's developerApiFailureContract doesn't
-- recognize, so it fell through to its generic default: HTTP 400
-- "The request could not be completed." for a call that should have
-- returned `{ status: "ok", connections: [] }`.
--
-- Fixed at the source (the SQL function), not by adding an "unknown" case
-- to the failure-contract switch on the TS side -- that would still return
-- the WRONG status for a legitimately-empty list, just with a different
-- wrong HTTP code instead of the right 200. The only change is guaranteeing
-- the 'ok' status is emitted as its own row when no connection rows exist;
-- the WHERE clause that actually decides which connections a customer may
-- see is byte-for-byte unchanged, so customer isolation is untouched.

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
as $$ select '20261003000013'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
