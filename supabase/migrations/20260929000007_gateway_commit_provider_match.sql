-- Corrective: the mock and lexical providers report an intrinsic model name
-- ("mock-heuristic", "lexical-overlap") that need not equal the free-text
-- `model` a tenant typed into settings — only a hosted provider's model is
-- tenant-chosen. Requiring an exact match silently discarded valid evidence
-- (and, in enforce mode, made a required call fail closed for no reason).
-- Evidence must still come from the configured *provider*; for
-- openai_compatible the model must match too. Enforceability now simply
-- requires that accepted evidence exists for an enforcement-grade provider.
-- No other behavior changes.

create or replace function gateway.commit_authorization(
  p_credential_secret text,
  p_task_id uuid,
  p_tool text,
  p_operation text,
  p_resource text,
  p_args jsonb,
  p_argument_audit jsonb,
  p_plan_node_id uuid,
  p_idempotency_key text,
  p_registry_version text,
  p_compiler_version text,
  p_risk_class text,
  p_max_uses integer,
  p_token_hash text,
  p_sem_provider text,
  p_sem_model text,
  p_sem_model_version text,
  p_sem_state public.semantic_evidence_state,
  p_sem_signals jsonb,
  p_sem_indicators text[],
  p_sem_risk public.semantic_risk_level,
  p_sem_confidence double precision,
  p_sem_latency_ms integer,
  p_sem_input_hash text,
  p_sem_redaction jsonb,
  p_sem_error_category text,
  p_gateway_version text
)
returns table (
  r_status text,
  r_replayed boolean,
  r_decision_id uuid,
  r_final_decision_id uuid,
  r_tool_request_id uuid,
  r_det_outcome public.authorization_outcome,
  r_final_outcome public.authorization_outcome,
  r_reason_codes text[],
  r_contract_id uuid,
  r_contract_version integer,
  r_semantic_mode public.semantic_mode,
  r_semantic_policy text,
  r_degraded boolean,
  r_degraded_reason text,
  r_narrowed boolean,
  r_capability_id uuid,
  r_capability_expires_at timestamptz,
  r_capability_max_uses integer,
  r_remaining_invocations integer
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_tenant uuid;
  v_agent uuid;
  v_cred uuid;
  v_task_agent uuid;
  v_request_hash text;
  v_args_hash text;
  v_existing_req uuid;
  v_existing_hash text;
  -- deterministic
  v_det public.authorization_outcome;
  v_det_reasons jsonb;
  v_contract_id uuid;
  v_contract_version integer;
  v_contract_expires timestamptz;
  v_action jsonb;
  v_budget_id uuid;
  v_max_per_action integer;
  v_reservable boolean;
  -- settings
  v_mode public.semantic_mode := 'off';
  v_provider text := 'mock';
  v_model text := 'mock-heuristic';
  v_classes text[] := '{}'::text[];
  v_ttl integer := 60;
  v_env public.tenant_environment;
  v_grade boolean;
  v_enforceable boolean;
  v_required boolean;
  v_policy text;
  -- composition
  v_final public.authorization_outcome;
  v_comp_reasons text[];
  v_degraded boolean;
  v_degraded_reason text;
  v_sem_state public.semantic_evidence_state;
  -- ids
  v_request_id uuid;
  v_decision_id uuid := gen_random_uuid();
  v_final_id uuid := gen_random_uuid();
  v_sem_eval_id uuid;
  v_token_id uuid;
  v_token_expires timestamptz;
  v_remaining integer;
  v_cap_after integer;
  v_all_reasons text[];
  v_permits boolean;
  v_replay_reasons text[];
begin
  if p_tool is null or p_tool !~ '^[a-z0-9_]+\.[a-z0-9_]+$' then
    raise exception 'malformed tool identifier' using errcode = '22023';
  end if;
  if p_operation is null or char_length(btrim(p_operation)) < 1 or char_length(p_operation) > 100 then
    raise exception 'operation is required' using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 1 or char_length(p_idempotency_key) > 200 then
    raise exception 'idempotency key is required and must be 1-200 characters' using errcode = '22023';
  end if;
  if p_registry_version is null or p_compiler_version is null or p_gateway_version is null then
    raise exception 'registry, compiler and gateway versions are required' using errcode = '22023';
  end if;
  if p_risk_class is null or p_risk_class not in ('low', 'medium', 'high') then
    raise exception 'risk class must be low, medium or high' using errcode = '22023';
  end if;
  if p_max_uses is null or p_max_uses not between 1 and 5 then
    raise exception 'max uses must be between 1 and 5' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' or pg_column_size(p_args) > 16384 then
    raise exception 'arguments must be an object of at most 16 KB' using errcode = '22023';
  end if;
  if p_argument_audit is null or pg_column_size(p_argument_audit) > 8192 then
    raise exception 'argument audit is required and must be at most 8 KB' using errcode = '22023';
  end if;
  if p_resource is not null and char_length(p_resource) > 200 then
    raise exception 'resource identifier too long' using errcode = '22023';
  end if;

  select rc.rc_status, rc.rc_tenant_id, rc.rc_agent_id, rc.rc_credential_id into v_status, v_tenant, v_agent, v_cred
  from gateway.resolve_credential(p_credential_secret) rc;

  if v_status <> 'ok' then
    return query select v_status, false, null::uuid, null::uuid, null::uuid, null::public.authorization_outcome,
      null::public.authorization_outcome, '{}'::text[], null::uuid, null::integer, 'off'::public.semantic_mode, 'not_applicable'::text,
      false, null::text, false, null::uuid, null::timestamptz, null::integer, null::integer;
    return;
  end if;

  select t.agent_id into v_task_agent from public.tasks t where t.id = p_task_id and t.tenant_id = v_tenant;
  if v_task_agent is null or v_task_agent <> v_agent then
    return query select case when v_task_agent is null then 'task_not_found' else 'agent_mismatch' end, false,
      null::uuid, null::uuid, null::uuid, null::public.authorization_outcome, null::public.authorization_outcome,
      '{}'::text[], null::uuid, null::integer, 'off'::public.semantic_mode, 'not_applicable'::text,
      false, null::text, false, null::uuid, null::timestamptz, null::integer, null::integer;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.runtime_authorize:' || p_task_id::text, 0));

  v_args_hash := encode(extensions.digest(p_args::text, 'sha256'), 'hex');
  v_request_hash := encode(extensions.digest(
    p_tool || '|' || p_operation || '|' || coalesce(p_resource, '') || '|' || v_args_hash || '|' || coalesce(p_plan_node_id::text, ''),
    'sha256'), 'hex');

  select tr.id, tr.request_hash into v_existing_req, v_existing_hash
  from public.tool_requests tr
  where tr.tenant_id = v_tenant and tr.task_id = p_task_id and tr.idempotency_key = p_idempotency_key;

  if v_existing_req is not null then
    if v_existing_hash is distinct from v_request_hash then
      return query select 'idempotency_conflict'::text, false, null::uuid, null::uuid, null::uuid,
        null::public.authorization_outcome, null::public.authorization_outcome, '{}'::text[], null::uuid, null::integer,
        'off'::public.semantic_mode, 'not_applicable'::text, false, null::text, false, null::uuid, null::timestamptz,
        null::integer, null::integer;
      return;
    end if;

    -- Idempotent replay: return the stored result. A capability's plaintext is
    -- never re-shown (only its hash exists); its id/expiry are returned.
    return query
      select 'ok'::text, true, d.id, f.id, d.tool_request_id, d.outcome, f.final_outcome,
             f.composition_reasons || array(select item ->> 'code' from jsonb_array_elements(d.reason_codes -> 'items') item),
             d.contract_id, d.contract_version, f.semantic_mode, f.semantic_policy, f.degraded, f.degraded_reason,
             f.narrowed, ct.id, ct.expires_at, ct.max_uses,
             (select cap.max_invocations - cap.consumed_uses from public.capabilities cap where cap.id = ct.budget_capability_id)
      from public.authorization_decisions d
      join public.final_decisions f on f.authorization_decision_id = d.id
      left join public.capability_tokens ct on ct.final_decision_id = f.id
      where d.tool_request_id = v_existing_req;
    if found then return; end if;
    -- A pre-Part-6 request (no final decision row): its decision stands as final.
    return query
      select 'ok'::text, true, d.id, null::uuid, d.tool_request_id, d.outcome, d.outcome,
             array(select item ->> 'code' from jsonb_array_elements(d.reason_codes -> 'items') item),
             d.contract_id, d.contract_version, 'off'::public.semantic_mode, 'not_applicable'::text, false, null::text,
             false, null::uuid, null::timestamptz, null::integer, null::integer
      from public.authorization_decisions d where d.tool_request_id = v_existing_req;
    return;
  end if;

  -- Deterministic evaluation: authoritative, under the lock, arguments used in memory only.
  select ed.ed_outcome, ed.ed_reasons, ed.ed_contract_id, ed.ed_contract_version, ed.ed_contract_expires_at,
         ed.ed_action, ed.ed_budget_capability_id, ed.ed_max_per_action, ed.ed_reservable
    into v_det, v_det_reasons, v_contract_id, v_contract_version, v_contract_expires,
         v_action, v_budget_id, v_max_per_action, v_reservable
  from gateway.evaluate_deterministic(v_tenant, p_task_id, p_tool, p_args, p_registry_version, p_compiler_version, p_max_uses) ed;

  -- Semantic settings are read here, in the transaction, not taken from the caller.
  select ss.mode, ss.provider, ss.model, ss.semantic_required_classes, ss.capability_ttl_seconds
    into v_mode, v_provider, v_model, v_classes, v_ttl
  from public.semantic_settings ss where ss.tenant_id = v_tenant;
  if not found then
    v_mode := 'off'; v_provider := 'mock'; v_model := 'mock-heuristic'; v_classes := '{}'::text[]; v_ttl := 60;
  end if;
  select te.environment into v_env from public.tenants te where te.id = v_tenant;
  v_grade := gateway.provider_enforcement_grade(v_provider, v_env);

  -- Evidence must come from the provider the tenant configured; anything else is ignored as if absent.
  if p_sem_state is not null and p_sem_provider is not distinct from v_provider
     and (v_provider <> 'openai_compatible' or p_sem_model is not distinct from v_model)
     and v_mode <> 'off' then
    v_sem_state := p_sem_state;
    if (p_sem_state = 'ok') <> (p_sem_signals is not null) then
      raise exception 'signals must be present exactly when state is ok' using errcode = '22023';
    end if;
    if p_sem_signals is not null and not authz.valid_semantic_signals(p_sem_signals) then
      raise exception 'signals violate the evidence contract' using errcode = '22023';
    end if;
    if p_sem_state <> 'ok' and p_sem_risk <> 'unknown' then
      raise exception 'a non-ok evaluation must have unknown risk' using errcode = '22023';
    end if;
    if p_sem_state = 'ok' and (p_sem_risk is null or p_sem_risk = 'unknown') then
      raise exception 'an ok evaluation must carry a known risk level' using errcode = '22023';
    end if;
    if p_sem_input_hash is null or p_sem_input_hash !~ '^[0-9a-f]{64}$' or p_sem_redaction is null
       or pg_column_size(p_sem_redaction) > 2048 or p_sem_model_version is null then
      raise exception 'semantic evidence is malformed' using errcode = '22023';
    end if;
  else
    v_sem_state := null;
  end if;

  v_enforceable := (v_mode = 'enforce' and v_grade and v_sem_state is not null);
  v_required := (v_mode = 'enforce' and p_risk_class = any(v_classes));
  v_policy := case when v_mode = 'off' then 'not_applicable' when v_required then 'required' else 'optional' end;

  select cp.c_final, cp.c_reasons, cp.c_degraded, cp.c_degraded_reason
    into v_final, v_comp_reasons, v_degraded, v_degraded_reason
  from gateway.compose_outcome(v_det, v_mode, v_sem_state,
    case when v_sem_state is null then null else p_sem_risk end, v_required, v_enforceable) cp;

  v_permits := v_final in ('allow', 'allow_constrained');
  v_all_reasons := v_comp_reasons || array(select item ->> 'code' from jsonb_array_elements(v_det_reasons) item);

  -- ---- persistence ------------------------------------------------------
  insert into public.tool_requests (
    tenant_id, task_id, plan_id, plan_node_id, agent_id, tool, operation, resource,
    normalized_arguments, destination_metadata, provenance, idempotency_key, request_hash,
    argument_audit, arguments_redacted, arguments_hash
  ) values (
    v_tenant, p_task_id, null, p_plan_node_id, v_agent, p_tool, p_operation, p_resource,
    '{"schemaVersion":1,"values":{}}'::jsonb, null, 'agent_proposed', p_idempotency_key, v_request_hash,
    p_argument_audit, true, v_args_hash
  ) returning id into v_request_id;

  -- Budget is reserved only for a FINAL allow: a semantic narrowing never consumes it.
  if v_permits and v_reservable then
    if v_budget_id is null then
      insert into public.capabilities (
        tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
        status, max_invocations, consumed_uses, expires_at, contract_id
      ) values (
        v_tenant, p_task_id, v_decision_id, v_agent, p_tool,
        jsonb_build_object('schemaVersion', 1, 'items', coalesce(v_action -> 'constraints', '[]'::jsonb)),
        'active', v_max_per_action, p_max_uses, v_contract_expires, v_contract_id
      ) returning id into v_budget_id;
    else
      update public.capabilities set consumed_uses = consumed_uses + p_max_uses where id = v_budget_id;
    end if;
  else
    v_budget_id := case when v_permits then v_budget_id else null end;
  end if;

  insert into public.authorization_decisions (
    id, tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome, reason_codes, latency_ms, capability_id
  ) values (
    v_decision_id, v_tenant, p_task_id, v_request_id, v_contract_id, v_contract_version, v_det,
    jsonb_build_object('schemaVersion', 1, 'items', v_det_reasons), 0,
    case when v_permits and v_reservable then v_budget_id else null end
  );

  if v_sem_state is not null then
    insert into public.semantic_evaluations (
      tenant_id, task_id, tool_request_id, authorization_decision_id, agent_id, mode, enforcement_grade,
      provider, model, model_version, state, signals, indicators, risk_level, confidence, latency_ms,
      input_hash, redaction_summary, error_category
    ) values (
      v_tenant, p_task_id, v_request_id, v_decision_id, v_agent, v_mode, v_grade,
      p_sem_provider, p_sem_model, p_sem_model_version, v_sem_state, p_sem_signals, coalesce(p_sem_indicators, '{}'::text[]),
      p_sem_risk, coalesce(p_sem_confidence, 0), coalesce(p_sem_latency_ms, 0),
      p_sem_input_hash, p_sem_redaction, p_sem_error_category
    ) returning id into v_sem_eval_id;
  end if;

  insert into public.final_decisions (
    id, tenant_id, task_id, tool_request_id, authorization_decision_id, semantic_evaluation_id,
    deterministic_outcome, final_outcome, semantic_mode, semantic_policy, risk_class,
    composition_reasons, degraded, degraded_reason, narrowed, gateway_version
  ) values (
    v_final_id, v_tenant, p_task_id, v_request_id, v_decision_id, v_sem_eval_id,
    v_det, v_final, v_mode, v_policy, p_risk_class,
    v_comp_reasons, v_degraded, v_degraded_reason, v_final <> v_det, p_gateway_version
  );

  if v_permits and v_reservable then
    if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'a capability token hash is required for an allow' using errcode = '22023';
    end if;
    v_token_expires := least(now() + make_interval(secs => v_ttl), v_contract_expires);
    insert into public.capability_tokens (
      tenant_id, agent_id, task_id, credential_id, contract_id, contract_version, authorization_decision_id,
      final_decision_id, budget_capability_id, tool, operation, resource, resource_constraints, arguments_hash,
      max_uses, expires_at, token_hash
    ) values (
      v_tenant, v_agent, p_task_id, v_cred, v_contract_id, v_contract_version, v_decision_id,
      v_final_id, v_budget_id, p_tool, p_operation, p_resource,
      jsonb_build_object('schemaVersion', 1, 'items', coalesce(v_action -> 'constraints', '[]'::jsonb)),
      v_args_hash, p_max_uses, v_token_expires, p_token_hash
    ) returning id into v_token_id;

    insert into public.execution_events (
      tenant_id, task_id, capability_id, tool_request_id, decision_id, event_type, result_status, summary
    ) values (
      v_tenant, p_task_id, v_budget_id, v_request_id, v_decision_id, 'capability_issued', 'success',
      format('Capability issued for %s (simulation only — no external tool executes in this phase).', p_tool)
    );

    select cap.max_invocations - cap.consumed_uses into v_remaining from public.capabilities cap where cap.id = v_budget_id;
  end if;

  insert into public.execution_events (
    tenant_id, task_id, capability_id, tool_request_id, decision_id, event_type, result_status, summary
  ) values (
    v_tenant, p_task_id, case when v_permits and v_reservable then v_budget_id else null end, v_request_id, v_decision_id,
    'request_evaluated', case when v_permits then 'success' else 'blocked' end::public.execution_outcome,
    format('Runtime call to %s: deterministic %s, final %s (semantic %s).', p_tool, v_det, v_final, v_mode)
  );

  return query select 'ok'::text, false, v_decision_id, v_final_id, v_request_id, v_det, v_final, v_all_reasons,
    v_contract_id, v_contract_version, v_mode, v_policy, v_degraded, v_degraded_reason, v_final <> v_det,
    v_token_id, v_token_expires, case when v_token_id is null then null else p_max_uses end, v_remaining;
end;
$fn$;

revoke all on function gateway.commit_authorization(
  text, uuid, text, text, text, jsonb, jsonb, uuid, text, text, text, text, integer, text,
  text, text, text, public.semantic_evidence_state, jsonb, text[], public.semantic_risk_level, double precision,
  integer, text, jsonb, text, text
) from public;
grant execute on function gateway.commit_authorization(
  text, uuid, text, text, text, jsonb, jsonb, uuid, text, text, text, text, integer, text,
  text, text, text, public.semantic_evidence_state, jsonb, text[], public.semantic_risk_level, double precision,
  integer, text, jsonb, text, text
) to authority_gateway;
