-- ROLLBACK of migration 20261028000002 (remove disconnected connections) to schema 20261028000001.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/rollback/20261028_rollback_to_20261028000001_connections.sql
-- Drops the function and the check. The archived_at column is kept (archived connections simply reappear in the
-- previous code's lists); drop it by hand if wanted. Removes the migration from the Supabase history.

drop function if exists public.remove_connector_connection(uuid);
alter table public.connector_connections drop constraint if exists connector_connection_archived_only_when_disconnected;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261028000001'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;

delete from supabase_migrations.schema_migrations where version = '20261028000002';
