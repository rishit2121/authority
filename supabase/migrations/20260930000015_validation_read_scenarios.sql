-- Part 8: the campaign runner (server-only) loads a tenant's stored scenario versions (regression tests).
create or replace function gateway.vl_get_scenarios(p_tenant uuid, p_keys text[])
returns table (gs_key text, gs_version integer, gs_definition jsonb, gs_source text, gs_id uuid, gs_regression_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (v.scenario_key) v.scenario_key, v.version, v.definition, v.source, v.id, r.id
  from public.validation_scenario_versions v
  left join public.validation_regressions r on r.scenario_version_id = v.id and r.tenant_id = v.tenant_id
  where v.tenant_id = p_tenant and v.scenario_key = any (p_keys)
  order by v.scenario_key, v.version desc;
$$;
revoke all on function gateway.vl_get_scenarios(uuid, text[]) from public;
grant execute on function gateway.vl_get_scenarios(uuid, text[]) to authority_gateway;
