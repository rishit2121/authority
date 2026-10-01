-- Adds the connection's own display name to the tenant-registry read, so
-- the plan-builder's tool picker (src/components/contract/CandidatePlanForm.tsx)
-- can show "Widget Orders API" rather than the opaque "custom_<hex>" id a
-- tenant never typed in themselves. A changed return-row shape requires a
-- drop (create or replace cannot change OUT parameters), same as
-- 20261001000008's create_connector_connection.
drop function if exists gateway.list_published_custom_operations_for_tenant(uuid);

create or replace function gateway.list_published_custom_operations_for_tenant(p_tenant_id uuid)
returns table (
  lpco_operation_id uuid,
  lpco_tool_name text,
  lpco_operation_slug text,
  lpco_name text,
  lpco_description text,
  lpco_effect text,
  lpco_input_schema jsonb,
  lpco_input_schema_hash text,
  lpco_request_mapping_hash text,
  lpco_connector_id text,
  lpco_connection_name text,
  lpco_published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select cod.id, cod.tool_name, cod.operation_slug, cod.name, cod.description, cod.effect,
         cod.input_schema, cod.input_schema_hash, cod.request_mapping_hash, cc.connector_id, cc.name, cod.published_at
  from public.custom_operation_definitions cod
  join public.connector_connections cc on cc.id = cod.connection_id
  where cod.tenant_id = p_tenant_id
    and cod.status = 'published'
    and cc.status = 'active'
  order by cod.tool_name;
$$;
revoke all on function gateway.list_published_custom_operations_for_tenant(uuid) from public;
grant execute on function gateway.list_published_custom_operations_for_tenant(uuid) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261001000011'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
