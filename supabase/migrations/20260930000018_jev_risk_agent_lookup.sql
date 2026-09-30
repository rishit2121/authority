-- Fix: gateway.record_jev_risk_evaluation must never trust a caller-supplied agent id (the TypeScript gateway layer
-- does not have one — CommitResult exposes no agent_id at all, by design: commit_authorization resolves the agent
-- from the credential secret entirely server-side). Resolves it itself from the already-verified tool_request
-- instead, the same source of truth commit_authorization itself used to write the decision in the first place.

create or replace function gateway.record_jev_risk_evaluation(p_tenant_id uuid, p_row jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_agent_id uuid;
begin
  select tr.agent_id into v_agent_id
  from public.tool_requests tr
  where tr.id = (p_row ->> 'toolRequestId')::uuid and tr.tenant_id = p_tenant_id;

  if v_agent_id is null then
    raise exception 'tool request not found for this tenant' using errcode = 'P0002';
  end if;

  insert into public.jev_risk_evaluations (
    tenant_id, task_id, tool_request_id, authorization_decision_id, agent_id, provider, model, model_version,
    input_hash, state, result, deterministic_decision, final_decision, disagreement, latency_ms, error_category
  ) values (
    p_tenant_id, (p_row ->> 'taskId')::uuid, (p_row ->> 'toolRequestId')::uuid, (p_row ->> 'authorizationDecisionId')::uuid,
    v_agent_id, p_row ->> 'provider', p_row ->> 'model', p_row ->> 'modelVersion', p_row ->> 'inputHash',
    p_row ->> 'state', p_row -> 'result', p_row ->> 'deterministicDecision', p_row ->> 'finalDecision',
    coalesce((p_row ->> 'disagreement')::boolean, false), (p_row ->> 'latencyMs')::integer, p_row ->> 'errorCategory'
  )
  on conflict (authorization_decision_id) do nothing
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function gateway.record_jev_risk_evaluation(uuid, jsonb) from public;
grant execute on function gateway.record_jev_risk_evaluation(uuid, jsonb) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20260930000018'::text $$;
