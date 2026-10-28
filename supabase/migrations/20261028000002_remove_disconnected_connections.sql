-- Removing a disconnected connection from the dashboard.
--
-- A connection cannot be deleted outright: execution receipts, reservations, secrets, published operations and task
-- bindings reference it, and receipts are append-only audit records. "Remove" therefore archives it: a disconnected
-- connection gets archived_at, and the dashboard stops listing it. Its history stays intact. Only a disconnected
-- connection can be archived, so this never revokes or changes anything that still works.
-- Rollback: supabase/rollback/20261028_rollback_to_20261028000001_connections.sql.

alter table public.connector_connections add column if not exists archived_at timestamptz;
alter table public.connector_connections drop constraint if exists connector_connection_archived_only_when_disconnected;
alter table public.connector_connections add constraint connector_connection_archived_only_when_disconnected
  check (archived_at is null or status = 'disconnected');

-- Admins and owners of the connection's tenant. Returns ok, not_found, forbidden or not_disconnected.
create or replace function public.remove_connector_connection(p_connection_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_tenant uuid; v_status public.connector_connection_status;
begin
  if (select auth.uid()) is null then
    raise exception 'remove_connector_connection() requires an authenticated caller' using errcode = '28000';
  end if;
  select tenant_id, status into v_tenant, v_status from public.connector_connections where id = p_connection_id;
  if v_tenant is null or not authz.is_member_of(v_tenant) then return 'not_found'; end if;
  if not authz.has_min_role(v_tenant, 'admin') then return 'forbidden'; end if;
  if v_status <> 'disconnected' then return 'not_disconnected'; end if;
  update public.connector_connections set archived_at = now()
  where id = p_connection_id and archived_at is null;
  return 'ok';
end;
$fn$;
revoke all on function public.remove_connector_connection(uuid) from public, anon;
grant execute on function public.remove_connector_connection(uuid) to authenticated;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261028000002'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
