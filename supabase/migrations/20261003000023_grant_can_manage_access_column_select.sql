-- Fixes a real bug found live while e2e-testing the new access-management
-- panel: 20261003000020 added developer_backend_credentials.can_manage_access
-- but never extended the table's column-level SELECT grant to include it.
-- `grant select (id, tenant_id, application_id, ...) on
-- developer_backend_credentials to authenticated` in
-- 20261003000002_developer_backend_credentials.sql is a column-level grant
-- -- restrictive by nature, so any query selecting a column outside that
-- explicit list (including the new one) is rejected for `authenticated`
-- with insufficient-privilege, regardless of RLS passing. The dashboard's
-- own Supabase client silently surfaced this as `data: null`, which every
-- call site defaults to an empty array -- so the ENTIRE backend credentials
-- list disappeared the moment the application detail page's query asked
-- for can_manage_access, not just that one new column.
grant select (can_manage_access) on public.developer_backend_credentials to authenticated;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000023'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
