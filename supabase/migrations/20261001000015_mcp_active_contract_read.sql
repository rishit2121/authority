-- A side-effect-free read of a task's active contract's allowed actions,
-- for the MCP bridge's tools/list discovery step (Phase 17 of the
-- agent-integration roadmap) -- same pattern and justification as
-- gateway.tenant_for_task and gateway.jev_risk_mode_for_task (plain reads,
-- none of prepare_authorization's rate-limiting/auth-event side effects,
-- safe to call once per MCP session in addition to, never instead of, the
-- real authorize+execute pipeline every actual tool call still goes
-- through). This is a discovery convenience only -- it grants nothing by
-- itself; an MCP client's `tools/call` is authorized and executed through
-- the exact same deterministic pipeline (gateway.prepare_authorization /
-- commit_authorization / reserve_connector_execution) as every other
-- caller, with no shortcut.
create or replace function gateway.active_contract_for_task(p_task_id uuid)
returns table (acft_contract_id uuid, acft_allowed_actions jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select id, allowed_actions
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
as $$ select '20261001000015'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
