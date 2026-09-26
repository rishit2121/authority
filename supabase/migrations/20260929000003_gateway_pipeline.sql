-- Part 6: the gateway pipeline functions. Callable only by authority_gateway.
--
-- Lessons from Parts 4/5 are applied throughout: pgcrypto is schema-qualified;
-- every RETURNS TABLE column is prefixed so none shadows a table column; every
-- table is aliased; no `record` variable is dereferenced on a path where it may
-- be unassigned (scalars instead); and anything that must persist while
-- reporting a failure RETURNS a status instead of raising (a raise rolls the
-- whole function's writes back, which silently lost Part 4's failed-auth audit).

create or replace function gateway.provider_enforcement_grade(
  p_provider text,
  p_environment public.tenant_environment
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- A hosted, real model counts as enforcement-grade. The deterministic mock
  -- and the lexical baseline are heuristics, never production enforcement:
  -- they may enforce only inside a development tenant (tests / demos).
  select case
    when p_provider = 'openai_compatible' then true
    when p_provider in ('mock', 'legacy_lexical') then p_environment = 'development'
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- Credential resolution. Never raises for an authentication failure, so the
-- audit row it writes survives.
-- ---------------------------------------------------------------------------
create or replace function gateway.resolve_credential(p_secret text)
returns table (rc_status text, rc_tenant_id uuid, rc_agent_id uuid, rc_credential_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_prefix text;
  v_recent integer;
  v_id uuid;
  v_tenant uuid;
  v_agent uuid;
  v_status public.agent_credential_status;
  v_agent_status public.agent_status;
begin
  if p_secret is null or char_length(p_secret) < 10 or char_length(p_secret) > 200 then
    return query select 'invalid_credential'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  v_prefix := left(p_secret, 21);

  select count(*) into v_recent
  from public.agent_auth_events aae
  where aae.attempted_key_prefix = v_prefix
    and aae.outcome in ('invalid_credential', 'rate_limited')
    and aae.created_at > now() - interval '60 seconds';

  if v_recent >= 20 then
    if v_recent < 200 then
      insert into public.agent_auth_events (attempted_key_prefix, outcome) values (v_prefix, 'rate_limited');
    end if;
    return query select 'rate_limited'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  select ac.id, ac.tenant_id, ac.agent_id, ac.status
    into v_id, v_tenant, v_agent, v_status
  from public.agent_credentials ac
  where ac.key_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex');

  if v_id is null then
    insert into public.agent_auth_events (attempted_key_prefix, outcome) values (v_prefix, 'invalid_credential');
    return query select 'invalid_credential'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  select ag.status into v_agent_status from public.agents ag where ag.id = v_agent and ag.tenant_id = v_tenant;

  if v_status <> 'active' or v_agent_status is distinct from 'active'::public.agent_status then
    insert into public.agent_auth_events (tenant_id, agent_id, credential_id, attempted_key_prefix, outcome)
      values (v_tenant, v_agent, v_id, v_prefix, 'revoked_credential');
    return query select 'revoked_credential'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  update public.agent_credentials set last_used_at = now() where id = v_id;
  return query select 'ok'::text, v_tenant, v_agent, v_id;
end;
$fn$;
revoke all on function gateway.resolve_credential(text) from public;
grant execute on function gateway.resolve_credential(text) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Deterministic evaluation, extracted from Part 4's authorize_tool_call().
-- Reads only; the caller decides whether to persist or reserve anything. The
-- request's arguments are used here and nowhere persisted.
-- ---------------------------------------------------------------------------
create or replace function gateway.evaluate_deterministic(
  p_tenant_id uuid,
  p_task_id uuid,
  p_tool text,
  p_args jsonb,
  p_registry_version text,
  p_compiler_version text,
  p_uses integer
)
returns table (
  ed_outcome public.authorization_outcome,
  ed_reasons jsonb,
  ed_contract_id uuid,
  ed_contract_version integer,
  ed_contract_expires_at timestamptz,
  ed_action jsonb,
  ed_budget_capability_id uuid,
  ed_max_per_action integer,
  ed_reservable boolean
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_outcome public.authorization_outcome;
  v_reasons jsonb := '[]'::jsonb;
  v_task_status public.task_status;
  v_contract_id uuid;
  v_contract_version integer;
  v_contract_status public.contract_status;
  v_expires timestamptz;
  v_reg text;
  v_comp text;
  v_forbidden_resources text[];
  v_forbidden_ops text[];
  v_allowed jsonb;
  v_limits jsonb;
  v_action jsonb;
  v_constraint jsonb;
  v_key text;
  v_arg_raw jsonb;
  v_arg_value text;
  v_ok boolean;
  v_total_failing integer := 0;
  v_missing_failing integer := 0;
  v_candidates text[];
  v_pattern text;
  v_hit boolean := false;
  v_used_total integer;
  v_max_total integer;
  v_max_per_action integer;
  v_cap_id uuid;
  v_cap_used integer;
  v_cap_max integer;
  v_reservable boolean := false;
begin
  select t.status into v_task_status from public.tasks t where t.id = p_task_id and t.tenant_id = p_tenant_id;

  if v_task_status is null or v_task_status not in ('contract_issued', 'executing') then
    v_reasons := jsonb_build_array(jsonb_build_object(
      'code', 'TASK_NOT_EXECUTABLE',
      'detail', format('Task status is "%s"; runtime calls require contract_issued or executing.', coalesce(v_task_status::text, 'unknown')),
      'source', 'policy'));
    v_outcome := 'deny';
  else
    select c.id, c.version, c.contract_status, c.expires_at, c.registry_version, c.compiler_version,
           c.forbidden_resources, c.forbidden_operations, c.allowed_actions, c.ephemeral_limits
      into v_contract_id, v_contract_version, v_contract_status, v_expires, v_reg, v_comp,
           v_forbidden_resources, v_forbidden_ops, v_allowed, v_limits
    from public.task_authority_contracts c
    where c.task_id = p_task_id and c.contract_status = 'active';

    if v_contract_id is null then
      v_reasons := jsonb_build_array(jsonb_build_object('code', 'NO_ACTIVE_CONTRACT',
        'detail', 'No task authority contract is currently active for this task.', 'source', 'contract'));
      v_outcome := 'deny';
    elsif not authz.contract_is_currently_active(v_contract_status, v_expires) then
      v_reasons := jsonb_build_array(jsonb_build_object('code', 'CONTRACT_NOT_CURRENTLY_ACTIVE',
        'detail', 'The active contract is expired; it has not yet been reconciled.', 'source', 'contract'));
      v_outcome := 'deny';
    elsif v_reg is distinct from p_registry_version or v_comp is distinct from p_compiler_version then
      v_reasons := jsonb_build_array(jsonb_build_object('code', 'UNSUPPORTED_CONTRACT_VERSION',
        'detail', 'The contract was compiled against a registry or compiler version no longer supported.', 'source', 'contract'));
      v_outcome := 'deny';
    else
      select array_agg(lower(cand)) into v_candidates
      from (
        select p_tool as cand
        union all
        select case when jsonb_typeof(je.value) = 'string' then je.value #>> '{}' else je.value::text end
        from jsonb_each(coalesce(p_args, '{}'::jsonb)) je
      ) c(cand);

      foreach v_pattern in array v_forbidden_resources loop
        if exists (select 1 from unnest(v_candidates) cand where authz.glob_match(v_pattern, cand)) then
          v_hit := true;
          exit;
        end if;
      end loop;

      if v_hit then
        v_reasons := jsonb_build_array(jsonb_build_object('code', 'FORBIDDEN_RESOURCE',
          'detail', 'Request matches a resource pattern the contract forbids.', 'source', 'policy'));
        v_outcome := 'deny';
      elsif p_tool = any(v_forbidden_ops) then
        v_reasons := jsonb_build_array(jsonb_build_object('code', 'FORBIDDEN_OPERATION',
          'detail', 'This exact operation is denied by an active policy.', 'source', 'policy'));
        v_outcome := 'deny';
      else
        select item into v_action
        from jsonb_array_elements(v_allowed -> 'items') item
        where item ->> 'tool' = p_tool
        limit 1;

        if v_action is null then
          v_reasons := jsonb_build_array(jsonb_build_object('code', 'TOOL_NOT_IN_CONTRACT',
            'detail', 'This tool is not an allowed action on the task authority contract.', 'source', 'contract'));
          v_outcome := 'replan';
        else
          for v_constraint in select cv.value from jsonb_array_elements(coalesce(v_action -> 'constraints', '[]'::jsonb)) cv
          loop
            v_key := v_constraint ->> 'key';
            v_arg_raw := p_args -> v_key;
            if v_arg_raw is null then
              v_total_failing := v_total_failing + 1;
              v_missing_failing := v_missing_failing + 1;
              continue;
            end if;
            if jsonb_typeof(v_arg_raw) = 'array' then
              select string_agg(elem, ',') into v_arg_value from jsonb_array_elements_text(v_arg_raw) elem;
            else
              v_arg_value := v_arg_raw #>> '{}';
            end if;
            v_ok := true;
            if v_constraint ? 'equals' then
              v_ok := (v_arg_value = (v_constraint ->> 'equals'));
            elsif v_constraint ? 'matches' then
              v_ok := authz.glob_match(v_constraint ->> 'matches', v_arg_value);
            end if;
            if not v_ok then
              v_total_failing := v_total_failing + 1;
            end if;
          end loop;

          if v_total_failing > 0 and v_missing_failing = v_total_failing then
            v_reasons := jsonb_build_array(jsonb_build_object('code', 'ARGUMENTS_UNDERSPECIFIED',
              'detail', 'One or more constrained arguments are missing from the request.', 'source', 'contract'));
            v_outcome := 'clarify';
          elsif v_total_failing > 0 then
            v_reasons := jsonb_build_array(jsonb_build_object('code', 'CONSTRAINT_VIOLATION',
              'detail', 'Arguments fall outside the contract''s constraints for this action.', 'source', 'contract'));
            v_outcome := 'deny';
          else
            select coalesce(sum(cap.consumed_uses), 0) into v_used_total
            from public.capabilities cap where cap.contract_id = v_contract_id;
            v_max_total := (v_limits ->> 'maxToolInvocations')::integer;
            v_max_per_action := coalesce((v_action ->> 'maxInvocations')::integer, v_max_total);

            select cap.id, cap.consumed_uses, cap.max_invocations into v_cap_id, v_cap_used, v_cap_max
            from public.capabilities cap where cap.contract_id = v_contract_id and cap.tool = p_tool;

            if v_used_total + p_uses > v_max_total then
              v_reasons := jsonb_build_array(jsonb_build_object('code', 'INVOCATION_LIMIT_REACHED',
                'detail', 'The task''s invocation budget is exhausted.', 'source', 'limit'));
              v_outcome := 'deny';
            elsif v_cap_id is not null and v_cap_used + p_uses > v_cap_max then
              v_reasons := jsonb_build_array(jsonb_build_object('code', 'INVOCATION_LIMIT_REACHED',
                'detail', 'This action''s invocation budget is exhausted.', 'source', 'limit'));
              v_outcome := 'deny';
            elsif v_cap_id is null and p_uses > v_max_per_action then
              v_reasons := jsonb_build_array(jsonb_build_object('code', 'INVOCATION_LIMIT_REACHED',
                'detail', 'This action''s invocation budget is exhausted.', 'source', 'limit'));
              v_outcome := 'deny';
            else
              v_reasons := jsonb_build_array(jsonb_build_object('code', 'WITHIN_CONTRACT',
                'detail', 'Permitted; the request satisfies every contract constraint.', 'source', 'contract'));
              v_outcome := case when jsonb_array_length(coalesce(v_action -> 'constraints', '[]'::jsonb)) > 0
                                then 'allow_constrained' else 'allow' end;
              v_reservable := true;
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;

  return query select v_outcome, v_reasons, v_contract_id, v_contract_version, v_expires, v_action,
                      v_cap_id, v_max_per_action, v_reservable;
end;
$fn$;
revoke all on function gateway.evaluate_deterministic(uuid, uuid, text, jsonb, text, text, integer) from public;
grant execute on function gateway.evaluate_deterministic(uuid, uuid, text, jsonb, text, text, integer) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Monotonic composition. The single place deterministic and semantic results
-- meet. Rules (also enforced independently by final_decisions' CHECKs):
--   * anything but a deterministic allow / allow_constrained is final as-is;
--   * shadow and off never change the outcome;
--   * in enforce mode a semantic verdict can only narrow an allow:
--       critical -> deny, high -> require_approval, otherwise unchanged;
--   * a degraded or unapproved semantic result fails closed (deny) when
--     semantic evidence is required for the call's risk class, and otherwise
--     keeps the deterministic result with an explicit degraded record.
-- ---------------------------------------------------------------------------
create or replace function gateway.compose_outcome(
  p_det public.authorization_outcome,
  p_mode public.semantic_mode,
  p_sem_state public.semantic_evidence_state,
  p_sem_risk public.semantic_risk_level,
  p_required boolean,
  p_enforceable boolean
)
returns table (c_final public.authorization_outcome, c_reasons text[], c_degraded boolean, c_degraded_reason text)
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_state public.semantic_evidence_state;
begin
  if p_det not in ('allow', 'allow_constrained') or p_mode <> 'enforce' then
    return query select p_det, '{}'::text[], false, null::text;
    return;
  end if;

  if not coalesce(p_enforceable, false) then
    v_state := 'unavailable';
  else
    v_state := coalesce(p_sem_state, 'unavailable');
  end if;

  if v_state <> 'ok' then
    if coalesce(p_required, false) then
      return query select 'deny'::public.authorization_outcome, array['SEMANTIC_REQUIRED_UNAVAILABLE']::text[], true,
        case when not coalesce(p_enforceable, false) then 'enforcement_not_approved' else v_state::text end;
    else
      return query select p_det, array['SEMANTIC_DEGRADED_OPTIONAL']::text[], true,
        case when not coalesce(p_enforceable, false) then 'enforcement_not_approved' else v_state::text end;
    end if;
    return;
  end if;

  if p_sem_risk = 'critical' then
    return query select 'deny'::public.authorization_outcome, array['SEMANTIC_CRITICAL_RISK']::text[], false, null::text;
  elsif p_sem_risk = 'high' then
    return query select 'require_approval'::public.authorization_outcome, array['SEMANTIC_HIGH_RISK']::text[], false, null::text;
  else
    return query select p_det, '{}'::text[], false, null::text;
  end if;
end;
$fn$;
revoke all on function gateway.compose_outcome(public.authorization_outcome, public.semantic_mode,
  public.semantic_evidence_state, public.semantic_risk_level, boolean, boolean) from public;
grant execute on function gateway.compose_outcome(public.authorization_outcome, public.semantic_mode,
  public.semantic_evidence_state, public.semantic_risk_level, boolean, boolean) to authority_gateway;

-- ---------------------------------------------------------------------------
-- prepare_authorization: authenticate, bind, and hand the gateway what it
-- needs to run semantic evaluation. Persists nothing about the request.
-- ---------------------------------------------------------------------------
create or replace function gateway.prepare_authorization(
  p_credential_secret text,
  p_task_id uuid,
  p_tool text,
  p_args jsonb,
  p_idempotency_key text,
  p_registry_version text,
  p_compiler_version text,
  p_risk_class text,
  p_uses integer
)
returns table (
  pr_status text,
  pr_mode public.semantic_mode,
  pr_provider text,
  pr_model text,
  pr_timeout_ms integer,
  pr_required boolean,
  pr_enforceable boolean,
  pr_capability_ttl_seconds integer,
  pr_task_intent text,
  pr_allowed_tools text[],
  pr_prior_calls jsonb,
  pr_det_outcome public.authorization_outcome,
  pr_already_decided boolean
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_tenant uuid;
  v_agent uuid;
  v_task_agent uuid;
  v_intent text;
  v_mode public.semantic_mode := 'off';
  v_provider text := 'mock';
  v_model text := 'mock-heuristic';
  v_timeout integer := 800;
  v_classes text[] := '{}'::text[];
  v_ttl integer := 60;
  v_env public.tenant_environment;
  v_grade boolean;
  v_det public.authorization_outcome;
  v_contract_id uuid;
  v_allowed text[] := '{}'::text[];
  v_prior jsonb;
  v_decided boolean := false;
begin
  select rc.rc_status, rc.rc_tenant_id, rc.rc_agent_id into v_status, v_tenant, v_agent
  from gateway.resolve_credential(p_credential_secret) rc;

  if v_status <> 'ok' then
    return query select v_status, 'off'::public.semantic_mode, null::text, null::text, null::integer, false, false,
      null::integer, null::text, '{}'::text[], '[]'::jsonb, null::public.authorization_outcome, false;
    return;
  end if;

  select t.agent_id, t.intent into v_task_agent, v_intent
  from public.tasks t where t.id = p_task_id and t.tenant_id = v_tenant;

  if v_task_agent is null then
    return query select 'task_not_found'::text, 'off'::public.semantic_mode, null::text, null::text, null::integer, false, false,
      null::integer, null::text, '{}'::text[], '[]'::jsonb, null::public.authorization_outcome, false;
    return;
  end if;
  if v_task_agent <> v_agent then
    return query select 'agent_mismatch'::text, 'off'::public.semantic_mode, null::text, null::text, null::integer, false, false,
      null::integer, null::text, '{}'::text[], '[]'::jsonb, null::public.authorization_outcome, false;
    return;
  end if;

  select ss.mode, ss.provider, ss.model, ss.timeout_ms, ss.semantic_required_classes, ss.capability_ttl_seconds
    into v_mode, v_provider, v_model, v_timeout, v_classes, v_ttl
  from public.semantic_settings ss where ss.tenant_id = v_tenant;
  if not found then
    v_mode := 'off'; v_provider := 'mock'; v_model := 'mock-heuristic'; v_timeout := 800; v_classes := '{}'::text[]; v_ttl := 60;
  end if;

  select te.environment into v_env from public.tenants te where te.id = v_tenant;
  v_grade := gateway.provider_enforcement_grade(v_provider, v_env);

  select exists (select 1 from public.tool_requests tr
                 where tr.tenant_id = v_tenant and tr.task_id = p_task_id and tr.idempotency_key = p_idempotency_key)
    into v_decided;

  select ed.ed_outcome, ed.ed_contract_id into v_det, v_contract_id
  from gateway.evaluate_deterministic(v_tenant, p_task_id, p_tool, p_args, p_registry_version, p_compiler_version, p_uses) ed;

  if v_contract_id is not null then
    select coalesce(array_agg(item ->> 'tool'), '{}'::text[]) into v_allowed
    from public.task_authority_contracts c, jsonb_array_elements(c.allowed_actions -> 'items') item
    where c.id = v_contract_id and c.tenant_id = v_tenant;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('tool', pc.tool, 'arguments', pc.args) order by pc.requested_at), '[]'::jsonb)
    into v_prior
  from (
    select p.tool, p.requested_at,
           case when p.arguments_redacted then
             coalesce((select jsonb_object_agg(e ->> 'key', e -> 'value')
                         from jsonb_array_elements(p.argument_audit -> 'entries') e where e ? 'value'), '{}'::jsonb)
           else coalesce(p.normalized_arguments -> 'values', '{}'::jsonb) end as args
    from public.tool_requests p
    where p.task_id = p_task_id and p.tenant_id = v_tenant and p.idempotency_key <> p_idempotency_key
    order by p.requested_at desc limit 5
  ) pc;

  return query select 'ok'::text, v_mode, v_provider, v_model, v_timeout,
    (v_mode = 'enforce' and p_risk_class = any(v_classes)),
    (v_mode = 'enforce' and v_grade),
    v_ttl, v_intent, v_allowed, v_prior, v_det, v_decided;
end;
$fn$;
revoke all on function gateway.prepare_authorization(text, uuid, text, jsonb, text, text, text, text, integer) from public;
grant execute on function gateway.prepare_authorization(text, uuid, text, jsonb, text, text, text, text, integer) to authority_gateway;
