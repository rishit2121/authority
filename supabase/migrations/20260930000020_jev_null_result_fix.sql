-- Fix: a JSON-serialized `null` is not a SQL NULL. Every Jev persistence caller
-- (`lib/jev/persistence.ts`, `lib/jev/risk-persistence.ts`) sends `result: null` in its row payload whenever an
-- evaluation did not reach state 'ok' (unavailable/timeout/error/circuit_open — precisely the cases this audit
-- trail most needs to capture, since those are the failure modes an operator has to notice). Once JSON-encoded
-- and sent over RPC, that becomes the JSON object key `"result":null`, and `p_row -> 'result'` extracts that as
-- the JSONB scalar `null` (a real, non-NULL jsonb VALUE representing the JSON null literal), not a SQL NULL.
--
-- Every one of the three `result jsonb check (result is null or (...))` constraints on the Jev tables therefore
-- rejected every single degraded/unavailable/timeout/error/circuit_open evaluation outright — found by running
-- the new pgTAP suite (22_jev_openrouter.sql) against a real database for the first time; no prior unit test
-- caught it because every earlier test mocked the database call itself.
--
-- Fix: coalesce a JSONB null literal into a real SQL NULL at the exact point of insertion, in all three
-- recording functions. No TypeScript change needed — sending an explicit `null` for "no result" was always the
-- correct, honest representation from the application's side; the bug was entirely in how the SQL read it back.

create or replace function public.record_jev_necessity_evaluation(p_tenant_id uuid, p_row jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'requires an authenticated caller' using errcode = '28000'; end if;
  if not authz.is_member_of(p_tenant_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if not authz.has_min_role(p_tenant_id, 'developer') then raise exception 'insufficient privileges' using errcode = '42501'; end if;

  insert into public.jev_necessity_evaluations (
    tenant_id, task_id, plan_id, node_key, tool, registry_version, compiler_version, mode, provider, model,
    model_version, input_hash, state, result, mechanical_status, final_status, disagreement, latency_ms, error_category
  ) values (
    p_tenant_id, (p_row ->> 'taskId')::uuid, (p_row ->> 'planId')::uuid, p_row ->> 'nodeKey', p_row ->> 'tool',
    p_row ->> 'registryVersion', p_row ->> 'compilerVersion', p_row ->> 'mode', p_row ->> 'provider', p_row ->> 'model',
    p_row ->> 'modelVersion', p_row ->> 'inputHash', p_row ->> 'state', nullif(p_row -> 'result', 'null'::jsonb),
    p_row ->> 'mechanicalStatus', p_row ->> 'finalStatus', coalesce((p_row ->> 'disagreement')::boolean, false),
    (p_row ->> 'latencyMs')::integer, p_row ->> 'errorCategory'
  ) returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function public.record_jev_completeness_evaluation(p_tenant_id uuid, p_row jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'requires an authenticated caller' using errcode = '28000'; end if;
  if not authz.is_member_of(p_tenant_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if not authz.has_min_role(p_tenant_id, 'developer') then raise exception 'insufficient privileges' using errcode = '42501'; end if;

  insert into public.jev_plan_completeness_evaluations (
    tenant_id, task_id, plan_id, provider, model, model_version, input_hash, state, result, latency_ms, error_category
  ) values (
    p_tenant_id, (p_row ->> 'taskId')::uuid, (p_row ->> 'planId')::uuid, p_row ->> 'provider', p_row ->> 'model',
    p_row ->> 'modelVersion', p_row ->> 'inputHash', p_row ->> 'state', nullif(p_row -> 'result', 'null'::jsonb),
    (p_row ->> 'latencyMs')::integer, p_row ->> 'errorCategory'
  ) returning id into v_id;
  return v_id;
end;
$fn$;

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
    p_row ->> 'state', nullif(p_row -> 'result', 'null'::jsonb), p_row ->> 'deterministicDecision', p_row ->> 'finalDecision',
    coalesce((p_row ->> 'disagreement')::boolean, false), (p_row ->> 'latencyMs')::integer, p_row ->> 'errorCategory'
  )
  on conflict (authorization_decision_id) do nothing
  returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20260930000020'::text $$;
