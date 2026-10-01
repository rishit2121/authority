-- Bump the schema-version probe to this build's newest migration, following
-- the same pattern every migration that touches it uses (see
-- 20260930000016/17/18/19/20_*.sql).
create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261001000002'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
