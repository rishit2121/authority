-- Adds the contract's own version number to gateway.active_contract_for_task's
-- result, needed by the new tool-manifest endpoint (GET
-- /api/v1/tasks/{taskId}/tools) to report which exact contract version a
-- manifest was computed against. Postgres requires DROP + CREATE (not
-- CREATE OR REPLACE) to change a RETURNS TABLE column list; behavior for
-- the existing column names is otherwise unchanged, so the MCP bridge's own
-- call site (src/lib/mcp/bridge.ts, via activeContractForTask in
-- src/lib/gateway/rpc.ts) keeps working unmodified -- it simply never reads
-- the new column.
drop function if exists gateway.active_contract_for_task(uuid);

create function gateway.active_contract_for_task(p_task_id uuid)
returns table (acft_contract_id uuid, acft_version integer, acft_allowed_actions jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select id, version, allowed_actions
  from public.task_authority_contracts
  where task_id = p_task_id and contract_status = 'active'
  order by version desc
  limit 1;
$$;
revoke all on function gateway.active_contract_for_task(uuid) from public;
grant execute on function gateway.active_contract_for_task(uuid) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261002000003'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
