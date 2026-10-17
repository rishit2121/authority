-- pilot_admin_set_gate() updated the single pilot_settings row without a
-- WHERE clause. Requests through the Supabase API load pg-safeupdate, which
-- rejects that ("UPDATE requires a WHERE clause"), so the dashboard toggle
-- always failed. Same behavior, explicit row.
create or replace function public.pilot_admin_set_gate(p_enabled boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform authz.require_pilot_owner();
  update public.pilot_settings set gate_enabled = coalesce(p_enabled, false), updated_at = now() where id;
  return 'ok';
end;
$$;
revoke all on function public.pilot_admin_set_gate(boolean) from public, anon;
grant execute on function public.pilot_admin_set_gate(boolean) to authenticated;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261017000002'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
