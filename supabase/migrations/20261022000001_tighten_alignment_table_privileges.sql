-- Issue #58: the five task-alignment tables kept the platform's default table privileges, so
-- `authenticated` held INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER with no write policies.
-- Verified on the hosted project (catalog + rolled-back write attempts): INSERT was refused by RLS and
-- UPDATE/DELETE affected 0 rows, but TRUNCATE is not governed by RLS, so the grant alone was unsafe.
-- No path through the product API reached it (PostgREST has no TRUNCATE; no invoker-rights function writes
-- these tables), and every legitimate write goes through SECURITY DEFINER functions owned by postgres,
-- which this does not touch. Tenant-scoped reads keep SELECT and their existing RLS policies.

revoke insert, update, delete, truncate, references, trigger on table
  public.alignment_reviews,
  public.alignment_settings,
  public.external_content_items,
  public.task_alignment_state,
  public.task_objectives
from authenticated, anon, public;

-- The mechanism: tables created by `postgres` in `public` defaulted to every privilege for anon and
-- authenticated, so each migration had to remember to revoke. From now on a new table gives anon nothing
-- and authenticated SELECT only (still subject to RLS); writes need an explicit grant backed by policies,
-- which 07_schema_inventory.sql enforces. Existing tables are unaffected. Functions and sequences keep
-- their current defaults (out of scope here). Objects created by supabase_admin are platform-managed.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from anon;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261022000001'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
