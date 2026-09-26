-- Part 5: RPCs for semantic shadow evaluation.
--
-- Written against the lessons of Part 4's corrective migrations: pgcrypto is
-- schema-qualified, RETURNS TABLE columns are prefixed so none can shadow a
-- table column, every table is aliased, and no `record` variable is
-- referenced on a path where it may be unassigned.

-- ---------------------------------------------------------------------------
-- Part 4 fix: failed-authentication auditing never persisted.
--
-- authorize_tool_call() inserted an agent_auth_events row for a bad or
-- revoked credential and then `raise exception`d. An exception aborts the
-- function's whole transaction, so that insert was rolled back with it: no
-- failure was ever recorded, and the DB-driven rate limiter (which counts
-- those rows) never had anything to count. A row can only be persisted by a
-- call that *returns*, so recording is a separate RPC the route handler
-- calls after it sees a 28000 from authorize_tool_call().
-- ---------------------------------------------------------------------------
create or replace function public.record_agent_auth_failure(p_credential_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_prefix text;
  v_hash text;
  v_cred_id uuid;
  v_cred_tenant uuid;
  v_cred_agent uuid;
  v_cred_status public.agent_credential_status;
  v_recent integer;
begin
  if p_credential_secret is null or char_length(p_credential_secret) < 10 then
    return;
  end if;

  v_prefix := left(p_credential_secret, 21);

  -- Bound table growth: a flood of bad attempts for one prefix stops being
  -- recorded individually once the limiter has clearly already tripped.
  select count(*) into v_recent
  from public.agent_auth_events aae
  where aae.attempted_key_prefix = v_prefix and aae.created_at > now() - interval '60 seconds';
  if v_recent >= 200 then
    return;
  end if;

  v_hash := encode(extensions.digest(p_credential_secret, 'sha256'), 'hex');
  select ac.id, ac.tenant_id, ac.agent_id, ac.status
    into v_cred_id, v_cred_tenant, v_cred_agent, v_cred_status
  from public.agent_credentials ac where ac.key_hash = v_hash;

  if v_cred_id is null then
    insert into public.agent_auth_events (attempted_key_prefix, outcome) values (v_prefix, 'invalid_credential');
  elsif v_cred_status <> 'active' then
    insert into public.agent_auth_events (tenant_id, agent_id, credential_id, attempted_key_prefix, outcome)
      values (v_cred_tenant, v_cred_agent, v_cred_id, v_prefix, 'revoked_credential');
  end if;
end;
$fn$;

revoke all on function public.record_agent_auth_failure(text) from public, authenticated;
grant execute on function public.record_agent_auth_failure(text) to anon;

-- ---------------------------------------------------------------------------
-- Settings.
-- ---------------------------------------------------------------------------
create or replace function public.set_semantic_settings(
  p_tenant_id uuid,
  p_mode public.semantic_mode,
  p_provider text,
  p_model text,
  p_timeout_ms integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_principal_id uuid;
  v_previous jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'set_semantic_settings() requires an authenticated caller' using errcode = '28000';
  end if;
  if p_tenant_id is null or not authz.has_min_role(p_tenant_id, 'security_admin') then
    raise exception 'insufficient privileges to change semantic settings' using errcode = '42501';
  end if;
  if p_mode = 'enforce' then
    raise exception 'semantic enforcement is unavailable: direct callers of authorize_tool_call() can bypass any check made outside the database'
      using errcode = '0A000';
  end if;

  select p.id into v_principal_id
  from public.principals p
  where p.tenant_id = p_tenant_id and p.user_id = (select auth.uid());

  select jsonb_build_object('mode', s.mode, 'provider', s.provider, 'model', s.model, 'timeoutMs', s.timeout_ms)
    into v_previous
  from public.semantic_settings s where s.tenant_id = p_tenant_id;

  insert into public.semantic_settings as s (tenant_id, mode, provider, model, timeout_ms, updated_at, updated_by_principal_id)
  values (p_tenant_id, p_mode, p_provider, p_model, p_timeout_ms, now(), v_principal_id)
  on conflict (tenant_id) do update
    set mode = excluded.mode, provider = excluded.provider, model = excluded.model,
        timeout_ms = excluded.timeout_ms, updated_at = now(),
        updated_by_principal_id = excluded.updated_by_principal_id;

  insert into public.semantic_settings_audit (tenant_id, actor_principal_id, previous_settings, new_settings)
  values (p_tenant_id, v_principal_id, v_previous,
    jsonb_build_object('mode', p_mode, 'provider', p_provider, 'model', p_model, 'timeoutMs', p_timeout_ms));
end;
$fn$;

revoke all on function public.set_semantic_settings(uuid, public.semantic_mode, text, text, integer) from public, anon;
grant execute on function public.set_semantic_settings(uuid, public.semantic_mode, text, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Evaluation context: everything a semantic evaluation needs, derived from
-- persisted rows for one decision — never from what the caller says about it.
-- Authenticated by the same runtime credential as authorize_tool_call(), and
-- scoped to that credential's own tenant *and* agent.
-- ---------------------------------------------------------------------------
create or replace function public.get_semantic_evaluation_context(
  p_credential_secret text,
  p_decision_id uuid
)
returns table (
  ctx_mode public.semantic_mode,
  ctx_provider text,
  ctx_model text,
  ctx_timeout_ms integer,
  ctx_task_intent text,
  ctx_tool text,
  ctx_operation text,
  ctx_resource text,
  ctx_arguments jsonb,
  ctx_decision_outcome public.authorization_outcome,
  ctx_allowed_tools text[],
  ctx_prior_calls jsonb,
  ctx_existing_evaluation_id uuid
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_agent_id uuid;
  v_credential_status public.agent_credential_status;
  v_task_id uuid;
  v_request_id uuid;
  v_requested_at timestamptz;
  v_contract_id uuid;
  v_found boolean := false;
begin
  if p_credential_secret is null or p_decision_id is null then
    raise exception 'invalid runtime credential' using errcode = '28000';
  end if;

  select ac.tenant_id, ac.agent_id, ac.status into v_tenant_id, v_agent_id, v_credential_status
  from public.agent_credentials ac
  where ac.key_hash = encode(extensions.digest(p_credential_secret, 'sha256'), 'hex');

  if v_tenant_id is null or v_credential_status <> 'active' then
    raise exception 'invalid runtime credential' using errcode = '28000';
  end if;

  select d.task_id, d.tool_request_id, d.contract_id, tr.requested_at, true
    into v_task_id, v_request_id, v_contract_id, v_requested_at, v_found
  from public.authorization_decisions d
  join public.tool_requests tr on tr.id = d.tool_request_id and tr.tenant_id = d.tenant_id
  where d.id = p_decision_id and d.tenant_id = v_tenant_id and tr.agent_id = v_agent_id;

  -- Same answer for "no such decision", "another tenant's" and "another
  -- agent's": nothing distinguishes them to a caller.
  if not coalesce(v_found, false) then
    raise exception 'decision not found' using errcode = 'P0002';
  end if;

  return query
  select
    coalesce(ss.mode, 'off'::public.semantic_mode),
    coalesce(ss.provider, 'mock'),
    coalesce(ss.model, 'mock-heuristic'),
    coalesce(ss.timeout_ms, 800),
    t.intent,
    tr.tool,
    tr.operation,
    tr.resource,
    coalesce(tr.normalized_arguments -> 'values', '{}'::jsonb),
    d.outcome,
    coalesce(
      (select array_agg(item ->> 'tool')
         from public.task_authority_contracts c,
              jsonb_array_elements(c.allowed_actions -> 'items') item
        where c.id = v_contract_id and c.tenant_id = v_tenant_id),
      '{}'::text[]),
    coalesce(
      (select jsonb_agg(jsonb_build_object('tool', pr.tool, 'arguments', coalesce(pr.normalized_arguments -> 'values', '{}'::jsonb))
                        order by pr.requested_at)
         from (select p2.tool, p2.normalized_arguments, p2.requested_at
                 from public.tool_requests p2
                where p2.task_id = v_task_id and p2.tenant_id = v_tenant_id
                  and p2.id <> v_request_id and p2.requested_at <= v_requested_at
                order by p2.requested_at desc limit 5) pr),
      '[]'::jsonb),
    (select sse.id from public.semantic_shadow_evaluations sse where sse.authorization_decision_id = d.id)
  from public.authorization_decisions d
  join public.tool_requests tr on tr.id = d.tool_request_id and tr.tenant_id = d.tenant_id
  join public.tasks t on t.id = d.task_id and t.tenant_id = d.tenant_id
  left join public.semantic_settings ss on ss.tenant_id = d.tenant_id
  where d.id = p_decision_id and d.tenant_id = v_tenant_id;
end;
$fn$;

revoke all on function public.get_semantic_evaluation_context(text, uuid) from public, authenticated;
grant execute on function public.get_semantic_evaluation_context(text, uuid) to anon;

-- ---------------------------------------------------------------------------
-- Signal validation, in the database as well as in TypeScript: a row that
-- violates the evidence contract is refused regardless of who called.
-- ---------------------------------------------------------------------------
create or replace function authz.valid_semantic_signals(p_signals jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_signals is not null
    and jsonb_typeof(p_signals) = 'object'
    and (p_signals - array['schemaVersion','taskAlignment','resourceRelevance','scopeExpansion',
                           'externalDisclosure','promptInjection','suspiciousArgumentChange','planDeviation']) = '{}'::jsonb
    and p_signals ->> 'schemaVersion' = '1'
    and not exists (
      select 1 from unnest(array['taskAlignment','resourceRelevance','scopeExpansion','externalDisclosure',
                                 'promptInjection','suspiciousArgumentChange','planDeviation']) k
      where jsonb_typeof(p_signals -> k) is distinct from 'number'
         or (p_signals ->> k)::numeric < 0 or (p_signals ->> k)::numeric > 1
    );
$$;

create or replace function authz.semantic_disagreement_for(
  p_outcome public.authorization_outcome,
  p_risk public.semantic_risk_level
)
returns public.semantic_disagreement
language sql
immutable
set search_path = ''
as $$
  select case
    when p_outcome in ('allow', 'allow_constrained') and p_risk in ('high', 'critical')
      then 'semantic_flags_permitted'::public.semantic_disagreement
    when p_outcome in ('deny', 'replan') and p_risk = 'low'
      then 'semantic_clears_denied'::public.semantic_disagreement
    else 'none'::public.semantic_disagreement
  end;
$$;

revoke all on function authz.valid_semantic_signals(jsonb) from public, anon, authenticated;
revoke all on function authz.semantic_disagreement_for(public.authorization_outcome, public.semantic_risk_level)
  from public, anon, authenticated;

create or replace function public.record_semantic_shadow(
  p_credential_secret text,
  p_decision_id uuid,
  p_provider text,
  p_model text,
  p_model_version text,
  p_state public.semantic_evidence_state,
  p_signals jsonb,
  p_indicators text[],
  p_risk_level public.semantic_risk_level,
  p_confidence double precision,
  p_latency_ms integer,
  p_input_hash text,
  p_redaction_summary jsonb,
  p_error_category text
)
returns table (rec_evaluation_id uuid, rec_disagreement public.semantic_disagreement, rec_replayed boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_agent_id uuid;
  v_credential_status public.agent_credential_status;
  v_task_id uuid;
  v_request_id uuid;
  v_outcome public.authorization_outcome;
  v_mode public.semantic_mode;
  v_existing_id uuid;
  v_existing_disagreement public.semantic_disagreement;
  v_new_id uuid;
  v_disagreement public.semantic_disagreement;
  v_allowed_indicators text[] := array[
    'prompt_injection_phrase','instruction_override','secret_material_in_arguments','encoded_payload',
    'external_recipient','unrelated_resource_identifier','cross_repository_reference','amount_escalation',
    'tool_not_in_plan','plan_step_skipped','unexpected_side_effect','high_entropy_blob',
    'destructive_action_unrequested','ambiguous_task'];
begin
  if p_credential_secret is null or p_decision_id is null then
    raise exception 'invalid runtime credential' using errcode = '28000';
  end if;

  select ac.tenant_id, ac.agent_id, ac.status into v_tenant_id, v_agent_id, v_credential_status
  from public.agent_credentials ac
  where ac.key_hash = encode(extensions.digest(p_credential_secret, 'sha256'), 'hex');

  if v_tenant_id is null or v_credential_status <> 'active' then
    raise exception 'invalid runtime credential' using errcode = '28000';
  end if;

  select d.task_id, d.tool_request_id, d.outcome into v_task_id, v_request_id, v_outcome
  from public.authorization_decisions d
  join public.tool_requests tr on tr.id = d.tool_request_id and tr.tenant_id = d.tenant_id
  where d.id = p_decision_id and d.tenant_id = v_tenant_id and tr.agent_id = v_agent_id;

  if v_request_id is null then
    raise exception 'decision not found' using errcode = 'P0002';
  end if;

  select ss.mode into v_mode from public.semantic_settings ss where ss.tenant_id = v_tenant_id;
  if v_mode is distinct from 'shadow'::public.semantic_mode then
    raise exception 'semantic shadow evaluation is not enabled for this tenant' using errcode = '55000';
  end if;

  select sse.id, sse.disagreement into v_existing_id, v_existing_disagreement
  from public.semantic_shadow_evaluations sse where sse.authorization_decision_id = p_decision_id;
  if v_existing_id is not null then
    return query select v_existing_id, v_existing_disagreement, true;
    return;
  end if;

  if (p_state = 'ok') <> (p_signals is not null) then
    raise exception 'signals must be present exactly when state is ok' using errcode = '22023';
  end if;
  if p_signals is not null and not authz.valid_semantic_signals(p_signals) then
    raise exception 'signals violate the evidence contract' using errcode = '22023';
  end if;
  if p_state <> 'ok' and p_risk_level <> 'unknown' then
    raise exception 'a non-ok evaluation must have unknown risk' using errcode = '22023';
  end if;
  if not (coalesce(p_indicators, '{}'::text[]) <@ v_allowed_indicators) then
    raise exception 'unrecognized indicator code' using errcode = '22023';
  end if;
  if p_input_hash is null or p_input_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'input hash must be 64 lowercase hex characters' using errcode = '22023';
  end if;
  if p_redaction_summary is null or pg_column_size(p_redaction_summary) > 2048 then
    raise exception 'redaction summary missing or too large' using errcode = '22023';
  end if;

  v_disagreement := authz.semantic_disagreement_for(v_outcome, p_risk_level);

  insert into public.semantic_shadow_evaluations (
    tenant_id, task_id, tool_request_id, authorization_decision_id, agent_id, provider, model, model_version,
    state, signals, indicators, risk_level, confidence, latency_ms, disagreement, input_hash,
    redaction_summary, error_category
  ) values (
    v_tenant_id, v_task_id, v_request_id, p_decision_id, v_agent_id, p_provider, p_model, p_model_version,
    p_state, p_signals, coalesce(p_indicators, '{}'::text[]), p_risk_level, p_confidence, p_latency_ms,
    v_disagreement, p_input_hash, p_redaction_summary, p_error_category
  )
  returning id into v_new_id;

  return query select v_new_id, v_disagreement, false;
end;
$fn$;

revoke all on function public.record_semantic_shadow(
  text, uuid, text, text, text, public.semantic_evidence_state, jsonb, text[], public.semantic_risk_level,
  double precision, integer, text, jsonb, text
) from public, authenticated;
grant execute on function public.record_semantic_shadow(
  text, uuid, text, text, text, public.semantic_evidence_state, jsonb, text[], public.semantic_risk_level,
  double precision, integer, text, jsonb, text
) to anon;
