-- Generic, non-secret per-connection configuration (e.g. Custom API's base
-- URL). Deliberately generic rather than a custom-api-specific table: any
-- future connector may need its own small set of non-secret settings, and
-- this follows the same "one shared table, interpreted per connector_id"
-- principle as connector_connections itself. Secrets never go here -- see
-- connector_connection_secrets / Supabase Vault (20261001000006).
alter table public.connector_connections
  add column config jsonb not null default '{}'::jsonb;

-- Admin+ only, same boundary as every other connection-mutating RPC here.
-- Bumps config_version so capabilities/reservations pinned to the connection
-- are stamped against the generation that was active when issued, exactly
-- like a credential rotation.
create or replace function gateway.update_connector_connection_config(
  p_tenant_id uuid, p_user_id uuid, p_connection_id uuid, p_config jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'admin') then return 'forbidden'; end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'config must be a JSON object' using errcode = '22023';
  end if;
  update public.connector_connections
    set config = p_config, config_version = config_version + 1
    where id = p_connection_id and tenant_id = p_tenant_id and status <> 'disconnected';
  if not found then return 'not_found'; end if;
  return 'ok';
end;
$fn$;
revoke all on function gateway.update_connector_connection_config(uuid, uuid, uuid, jsonb) from public;
grant execute on function gateway.update_connector_connection_config(uuid, uuid, uuid, jsonb) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261001000007'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
