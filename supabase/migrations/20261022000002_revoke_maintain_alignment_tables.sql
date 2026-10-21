-- Follow-up to 20261022000001 (#58). Postgres 17 added the MAINTAIN table privilege (VACUUM, ANALYZE,
-- REINDEX, REFRESH MATERIALIZED VIEW, CLUSTER, LOCK TABLE), which the platform's default ACL also granted
-- (`arwdDxtm`) and which the first migration's revoke list did not name. Row level security does not govern
-- it; LOCK TABLE alone could block a table for every tenant. Effective MAINTAIN for authenticated existed on
-- exactly the same five tables (0 for anon), so this stays narrow.
revoke maintain on table
  public.alignment_reviews,
  public.alignment_settings,
  public.external_content_items,
  public.task_alignment_state,
  public.task_objectives
from authenticated, anon, public;

alter default privileges for role postgres in schema public
  revoke maintain on tables from authenticated;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261022000002'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
