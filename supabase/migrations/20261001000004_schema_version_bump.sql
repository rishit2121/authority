-- Bump the schema-version probe again, following the same pattern as
-- 20261001000002_schema_version_bump.sql.
create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261001000004'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
