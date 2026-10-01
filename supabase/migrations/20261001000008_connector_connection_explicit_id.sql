-- Custom API's connector_id must be derivable from the connection id alone,
-- with no database round trip, so that `normalizeRequest()` -- which has
-- only the tool name and the agent's arguments, no ConnectorContext (see
-- src/lib/connectors/types.ts) -- can recover exactly which tenant
-- connection a request belongs to directly from the tool string. The setup
-- wizard does this by generating the connection id itself
-- (`custom_<hex-without-dashes>`) and needs that same id to exist as the
-- row's own primary key, not a separately auto-generated one.
--
-- Every other connector (Stripe, Slack, Postgres) keeps relying on a plain
-- auto-generated id -- the new parameter defaults to null, which preserves
-- gen_random_uuid() exactly as before.
drop function if exists gateway.create_connector_connection(uuid, uuid, text, text, public.tenant_environment);

create or replace function gateway.create_connector_connection(
  p_tenant_id uuid, p_user_id uuid, p_connector_id text, p_name text, p_environment public.tenant_environment,
  p_connection_id uuid default null
)
returns table (cc_status text, cc_connection_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_principal uuid;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'admin') then
    return query select 'forbidden'::text, null::uuid; return;
  end if;
  if p_connector_id is null or p_connector_id !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'connector id must be lowercase alphanumeric/underscore, 1-64 chars' using errcode = '22023';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 200 then
    raise exception 'name must be 1-200 characters' using errcode = '22023';
  end if;
  v_principal := gateway.actor_principal(p_tenant_id, p_user_id);
  insert into public.connector_connections (id, tenant_id, connector_id, name, environment, connected_by_principal_id)
  values (coalesce(p_connection_id, gen_random_uuid()), p_tenant_id, p_connector_id, btrim(p_name), coalesce(p_environment, 'development'), v_principal)
  returning id into v_id;
  return query select 'ok'::text, v_id;
exception
  when unique_violation then
    return query select 'already_connected'::text, null::uuid;
end;
$fn$;
revoke all on function gateway.create_connector_connection(uuid, uuid, text, text, public.tenant_environment, uuid) from public;
grant execute on function gateway.create_connector_connection(uuid, uuid, text, text, public.tenant_environment, uuid) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261001000008'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
