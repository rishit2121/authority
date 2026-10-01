-- The Custom API connector's one read path for operation definitions.
-- `authority_gateway` has no table privileges at all (see TRUST_MODEL.md);
-- every table access goes through a security-definer gateway.* function, and
-- this is the one that lets `normalizeRequest()`/`execute()` -- which, per
-- src/lib/connectors/types.ts's ConnectorContext, have only a connection id
-- and the agent's arguments, never a human actor or tenant id -- resolve
-- exactly one operation.
--
-- `status = 'published'` is the hard gate: a draft or retired operation
-- cannot be resolved here no matter what tool name is presented, because a
-- capability naming it could only have been minted by the deterministic
-- pipeline compiling against the published registry in the first place (see
-- the module comment on custom_operation_definitions) -- but this function
-- enforces the same boundary again, independently, rather than trusting that
-- invariant alone.
create or replace function gateway.get_published_custom_operation(p_connection_id uuid, p_operation_slug text)
returns table (
  gpco_operation_id uuid,
  gpco_tool_name text,
  gpco_method text,
  gpco_path_template text,
  gpco_effect text,
  gpco_input_schema jsonb,
  gpco_request_mapping jsonb,
  gpco_auth_type text,
  gpco_auth_config jsonb,
  gpco_timeout_ms integer,
  gpco_connection_status text,
  gpco_connection_config jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select cod.id, cod.tool_name, cod.method, cod.path_template, cod.effect, cod.input_schema, cod.request_mapping,
         cod.auth_type, cod.auth_config, cod.timeout_ms, cc.status::text, cc.config
  from public.custom_operation_definitions cod
  join public.connector_connections cc on cc.id = cod.connection_id
  where cod.connection_id = p_connection_id
    and cod.operation_slug = p_operation_slug
    and cod.status = 'published';
$$;
revoke all on function gateway.get_published_custom_operation(uuid, text) from public;
grant execute on function gateway.get_published_custom_operation(uuid, text) to authority_gateway;

-- Generic connection health/config read, usable by any connector's
-- verifyInstallation() -- not Custom-API-specific, unlike the function
-- above. Returns null for a disconnected or nonexistent connection, which
-- verifyInstallation treats as "disconnected."
create or replace function gateway.get_connector_connection_config(p_connection_id uuid)
returns table (gccc_status text, gccc_config jsonb, gccc_last_verified_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select status::text, config, last_verified_at
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
as $$ select '20261001000009'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
