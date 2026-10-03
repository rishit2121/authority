-- gateway.get_connector_connection_config() is the one call every
-- connector's verifyInstallation() (and now Gmail's accessTokenFor()) makes
-- to read a connection's current state. Adding auth_mode to it means a
-- managed connection's hot path never needs to ask
-- gateway.resolve_connection_broker() at all -- that function, and the
-- whole broker table it reads from, is only ever consulted for a
-- connection actually marked auth_mode = 'broker'. Every existing caller
-- destructures named fields and is unaffected by the new one.

drop function if exists gateway.get_connector_connection_config(uuid);

create function gateway.get_connector_connection_config(p_connection_id uuid)
returns table (gccc_status text, gccc_config jsonb, gccc_last_verified_at timestamptz, gccc_auth_mode text)
language sql
stable
security definer
set search_path = ''
as $$
  select status::text, config, last_verified_at, auth_mode
  from public.connector_connections
  where id = p_connection_id and status <> 'disconnected';
$$;
revoke all on function gateway.get_connector_connection_config(uuid) from public;
grant execute on function gateway.get_connector_connection_config(uuid) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000010'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
