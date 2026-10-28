-- ROLLBACK of migration 20261027000001 (task-wide budgets) to schema 20261023000003.
--
-- Not a migration: nothing applies it automatically. Run it only to return the database to 20261023000003, in one transaction:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/rollback/20261027_rollback_to_20261023000003.sql
-- Restores, verbatim, gateway.evaluate_deterministic (20261023000001), gateway.commit_authorization and
-- gateway.mint_approved_capability (20260930000004) and gateway.activate_task_contract_core (20261015000003); drops the
-- trigger and the functions this migration added. The three tables are RENAMED with a _rb_20261027 suffix rather than
-- dropped, so the audit of seeds and raises is kept; delete them when no longer needed. Removes the migration from the
-- Supabase history so a later `supabase db push` re-applies it. Rolling back restores per-contract-version budgets.

drop trigger if exists capabilities_seed_task_allowance on public.capabilities;

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
  v_item jsonb;
  v_best jsonb;
  v_best_failing integer;
  v_best_missing integer;
  v_satisfied jsonb;
  v_undeclared integer := 0;
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
        -- A tool may have several allowed actions, one per distinct set of
        -- pinned arguments (e.g. "email Alice" and "email Bob"). The request is
        -- judged against the first action whose constraints it satisfies AND
        -- whose own budget remains; when it satisfies none, against the closest
        -- one (fewest failing constraints) for the clarify/deny reason.
        select coalesce(sum(cap.consumed_uses), 0) into v_used_total
        from public.capabilities cap where cap.contract_id = v_contract_id;
        v_max_total := (v_limits ->> 'maxToolInvocations')::integer;

        for v_item in
          select x.item
          from jsonb_array_elements(v_allowed -> 'items') with ordinality as x(item, ord)
          where x.item ->> 'tool' = p_tool
          order by x.ord
        loop
          v_total_failing := 0;
          v_missing_failing := 0;
          for v_constraint in select cv.value from jsonb_array_elements(coalesce(v_item -> 'constraints', '[]'::jsonb)) cv
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

          -- Closed-world arguments (actions compiled with `openArguments`): every supplied key must be pinned by this
          -- action or be one of its declared open (free-text) arguments. Each other key counts as a failing, not a
          -- missing, constraint, so the outcome is CONSTRAINT_VIOLATION. Actions without the field (compiled before
          -- it existed) keep the previous behavior, so this migration and the application deploy can land in either
          -- order; the compiler version bump retires those contracts once the new application is deployed.
          if v_item ? 'openArguments' then
            select count(*) into v_undeclared
            from jsonb_object_keys(coalesce(p_args, '{}'::jsonb)) as k(arg_key)
            where not exists (
                    select 1 from jsonb_array_elements(coalesce(v_item -> 'constraints', '[]'::jsonb)) c
                    where c ->> 'key' = k.arg_key)
              and not (coalesce(v_item -> 'openArguments', '[]'::jsonb) ? k.arg_key);
            v_total_failing := v_total_failing + v_undeclared;
          end if;

          if v_best is null or v_total_failing < v_best_failing then
            v_best := v_item;
            v_best_failing := v_total_failing;
            v_best_missing := v_missing_failing;
          end if;

          if v_total_failing = 0 then
            v_satisfied := v_item;
            -- This action's own budget row: keyed by its exact constraint set.
            select cap.id, cap.consumed_uses, cap.max_invocations into v_cap_id, v_cap_used, v_cap_max
            from public.capabilities cap
            where cap.contract_id = v_contract_id and cap.tool = p_tool
              and cap.resource_constraints =
                  jsonb_build_object('schemaVersion', 1, 'items', coalesce(v_item -> 'constraints', '[]'::jsonb));
            v_max_per_action := coalesce((v_item ->> 'maxInvocations')::integer, v_max_total);
            if (v_cap_id is not null and v_cap_used + p_uses > v_cap_max)
               or (v_cap_id is null and p_uses > v_max_per_action) then
              continue;
            end if;
            v_action := v_item;
            exit;
          end if;
        end loop;

        if v_best is null then
          v_reasons := jsonb_build_array(jsonb_build_object('code', 'TOOL_NOT_IN_CONTRACT',
            'detail', 'This tool is not an allowed action on the task authority contract.', 'source', 'contract'));
          v_outcome := 'replan';
        elsif v_satisfied is null then
          v_action := v_best;
          v_cap_id := null;
          if v_best_failing > 0 and v_best_missing = v_best_failing then
            v_reasons := jsonb_build_array(jsonb_build_object('code', 'ARGUMENTS_UNDERSPECIFIED',
              'detail', 'One or more constrained arguments are missing from the request.', 'source', 'contract'));
            v_outcome := 'clarify';
          else
            v_reasons := jsonb_build_array(jsonb_build_object('code', 'CONSTRAINT_VIOLATION',
              'detail', 'Arguments fall outside the contract''s constraints for this action.', 'source', 'contract'));
            v_outcome := 'deny';
          end if;
        elsif v_used_total + p_uses > v_max_total then
          v_action := coalesce(v_action, v_satisfied);
          v_reasons := jsonb_build_array(jsonb_build_object('code', 'INVOCATION_LIMIT_REACHED',
            'detail', 'The task''s invocation budget is exhausted.', 'source', 'limit'));
          v_outcome := 'deny';
        elsif v_action is null then
          v_action := v_satisfied;
          v_cap_id := null;
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

  return query select v_outcome, v_reasons, v_contract_id, v_contract_version, v_expires, v_action,
                      v_cap_id, v_max_per_action, v_reservable;
end;
$fn$;


revoke all on function gateway.evaluate_deterministic(uuid, uuid, text, jsonb, text, text, integer) from public;
grant execute on function gateway.evaluate_deterministic(uuid, uuid, text, jsonb, text, text, integer) to authority_gateway;

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
  p_gateway_version text,
  p_registry_requires_approval boolean
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
  v_approval_classes text[] := '{}'::text[];
  v_approval_trigger text;
  v_m record;
  v_evidence jsonb;
  v_required_approvals integer;
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
  -- Unused budget from expired/revoked capabilities is returned before anything is evaluated.
  perform gateway.sweep_task_budgets(p_task_id);

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

    -- An approved runtime approval is turned into a capability here, after every
    -- input is re-checked against CURRENT state (see gateway.mint_approved_capability).
    select m.* into v_m from gateway.mint_approved_capability(
      v_tenant, v_agent, v_cred, p_task_id, v_existing_req, p_tool, p_resource, p_args,
      p_registry_version, p_compiler_version, p_max_uses, p_token_hash) m;
    if v_m.m_status = 'minted' then
      return query
        select 'ok'::text, false, d.id, f.id, d.tool_request_id, d.outcome, 'allow'::public.authorization_outcome,
               array['APPROVAL_GRANTED']::text[] || array(select item ->> 'code' from jsonb_array_elements(d.reason_codes -> 'items') item),
               d.contract_id, d.contract_version, f.semantic_mode, f.semantic_policy, f.degraded, f.degraded_reason,
               f.narrowed, v_m.m_capability_id, v_m.m_expires_at, v_m.m_max_uses, v_m.m_remaining
        from public.authorization_decisions d
        join public.final_decisions f on f.authorization_decision_id = d.id
        where d.tool_request_id = v_existing_req;
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
  select ss.mode, ss.provider, ss.model, ss.semantic_required_classes, ss.capability_ttl_seconds, ss.runtime_approval_classes
    into v_mode, v_provider, v_model, v_classes, v_ttl, v_approval_classes
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

  -- Policy/registry approval requirements narrow an allow to require_approval.
  -- Like every composition step this can only make the outcome stricter.
  if v_final in ('allow', 'allow_constrained') then
    if coalesce(p_registry_requires_approval, false) then
      v_final := 'require_approval'; v_comp_reasons := v_comp_reasons || array['REGISTRY_REQUIRES_APPROVAL'];
      v_approval_trigger := 'registry_requires_approval';
    elsif p_risk_class = any (coalesce(v_approval_classes, '{}'::text[])) then
      v_final := 'require_approval'; v_comp_reasons := v_comp_reasons || array['POLICY_REQUIRES_APPROVAL'];
      v_approval_trigger := 'policy_class';
    end if;
  end if;
  if v_final = 'require_approval' and v_approval_trigger is null then v_approval_trigger := 'semantic_high_risk'; end if;

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

  if v_final = 'require_approval' and v_det in ('allow', 'allow_constrained') then
    v_required_approvals := case when p_risk_class = 'high' then 2 else 1 end;
    v_evidence := jsonb_build_object('schemaVersion', 1, 'deterministicOutcome', v_det, 'finalOutcome', v_final,
      'reasonCodes', to_jsonb(v_comp_reasons || array(select item ->> 'code' from jsonb_array_elements(v_det_reasons) item)),
      'semantic', case when v_sem_state is null then null else jsonb_build_object('state', v_sem_state,
         'riskLevel', p_sem_risk, 'indicators', to_jsonb(coalesce(p_sem_indicators, '{}'::text[]))) end);
    insert into public.runtime_approval_requests (
      tenant_id, task_id, agent_id, tool_request_id, authorization_decision_id, final_decision_id, contract_id,
      contract_version, tool, operation, resource, arguments_hash, request_hash, risk_class, trigger_kind, evidence,
      context_hash, required_approvals, expires_at
    ) values (
      v_tenant, p_task_id, v_agent, v_request_id, v_decision_id, v_final_id, v_contract_id,
      v_contract_version, p_tool, p_operation, p_resource, v_args_hash, v_request_hash, p_risk_class, v_approval_trigger, v_evidence,
      gateway.approval_context_hash(v_tenant, p_task_id, p_tool, p_resource), v_required_approvals, now() + interval '1 hour'
    );
    insert into public.execution_events (tenant_id, task_id, tool_request_id, decision_id, event_type, result_status, summary,
      normalized_effect_metadata)
    values (v_tenant, p_task_id, v_request_id, v_decision_id, 'approval_requested', 'blocked',
      format('Runtime call to %s needs approval (%s).', p_tool, v_approval_trigger),
      jsonb_build_object('schemaVersion', 1, 'phase', 'approval_requested'));
  end if;

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
  integer, text, jsonb, text, text, boolean
) from public;
grant execute on function gateway.commit_authorization(
  text, uuid, text, text, text, jsonb, jsonb, uuid, text, text, text, text, integer, text,
  text, text, text, public.semantic_evidence_state, jsonb, text[], public.semantic_risk_level, double precision,
  integer, text, jsonb, text, text, boolean
) to authority_gateway;

create or replace function gateway.mint_approved_capability(
  p_tenant_id uuid, p_agent_id uuid, p_credential_id uuid, p_task_id uuid, p_tool_request_id uuid,
  p_tool text, p_resource text, p_args jsonb, p_registry_version text, p_compiler_version text,
  p_max_uses integer, p_token_hash text
)
returns table (m_status text, m_capability_id uuid, m_expires_at timestamptz, m_max_uses integer, m_remaining integer, m_reason text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  ar public.runtime_approval_requests%rowtype;
  v_ed record;
  v_reason text;
  v_ttl integer := 60;
  v_budget uuid;
  v_token uuid;
  v_expires timestamptz;
  v_remaining integer;
  v_agent_status public.agent_status;
  v_cred_status public.agent_credential_status;
  v_permits boolean;
begin
  select * into ar from public.runtime_approval_requests where tool_request_id = p_tool_request_id and tenant_id = p_tenant_id;
  if ar.id is null then return query select 'none'::text, null::uuid, null::timestamptz, null::integer, null::integer, null::text; return; end if;

  if ar.status = 'pending' and ar.expires_at <= now() then
    update public.runtime_approval_requests set status = 'expired', resolved_at = now() where id = ar.id;
    return query select 'expired'::text, null::uuid, null::timestamptz, null::integer, null::integer, 'APPROVAL_EXPIRED'::text; return;
  end if;
  if ar.status <> 'approved' then
    return query select ar.status, null::uuid, null::timestamptz, null::integer, null::integer, ar.stale_reason; return;
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'a capability token hash is required to mint' using errcode = '22023';
  end if;

  if ar.expires_at <= now() then
    update public.runtime_approval_requests set status = 'expired', resolved_at = now() where id = ar.id;
    return query select 'expired'::text, null::uuid, null::timestamptz, null::integer, null::integer, 'APPROVAL_EXPIRED'::text; return;
  end if;

  select ed.ed_outcome, ed.ed_contract_id, ed.ed_contract_version, ed.ed_contract_expires_at, ed.ed_action,
         ed.ed_budget_capability_id, ed.ed_max_per_action, ed.ed_reservable into v_ed
  from gateway.evaluate_deterministic(p_tenant_id, p_task_id, p_tool, p_args, p_registry_version, p_compiler_version, p_max_uses) ed;

  select ag.status into v_agent_status from public.agents ag where ag.id = p_agent_id and ag.tenant_id = p_tenant_id;
  select ac.status into v_cred_status from public.agent_credentials ac where ac.id = p_credential_id and ac.tenant_id = p_tenant_id;

  if v_ed.ed_outcome not in ('allow', 'allow_constrained') then
    v_reason := 'DETERMINISTIC_NO_LONGER_ALLOWS';
  elsif v_ed.ed_contract_id is distinct from ar.contract_id or v_ed.ed_contract_version is distinct from ar.contract_version then
    v_reason := 'CONTRACT_CHANGED';
  elsif v_agent_status is distinct from 'active'::public.agent_status
        or v_cred_status is distinct from 'active'::public.agent_credential_status then
    v_reason := 'AGENT_OR_KEY_REVOKED';
  elsif gateway.approval_context_hash(p_tenant_id, p_task_id, p_tool, p_resource) <> ar.context_hash then
    v_reason := 'CONTEXT_CHANGED';
  elsif not coalesce(v_ed.ed_reservable, false) then
    v_reason := 'NOT_RESERVABLE';
  end if;

  if v_reason is not null then
    update public.runtime_approval_requests set status = 'stale', stale_reason = v_reason, resolved_at = now() where id = ar.id;
    insert into public.execution_events (tenant_id, task_id, tool_request_id, decision_id, event_type, result_status, summary,
      normalized_effect_metadata)
    values (p_tenant_id, p_task_id, ar.tool_request_id, ar.authorization_decision_id, 'approval_resolved', 'blocked',
      format('Approval for %s is stale (%s); no capability was minted.', p_tool, v_reason),
      jsonb_build_object('schemaVersion', 1, 'phase', 'approval_stale', 'reason', v_reason));
    return query select 'stale'::text, null::uuid, null::timestamptz, null::integer, null::integer, v_reason; return;
  end if;

  select ss.capability_ttl_seconds into v_ttl from public.semantic_settings ss where ss.tenant_id = p_tenant_id;
  v_ttl := coalesce(v_ttl, 60);
  v_budget := v_ed.ed_budget_capability_id;
  if v_budget is null then
    insert into public.capabilities (
      tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
      status, max_invocations, consumed_uses, expires_at, contract_id
    ) values (
      p_tenant_id, p_task_id, ar.authorization_decision_id, p_agent_id, p_tool,
      jsonb_build_object('schemaVersion', 1, 'items', coalesce(v_ed.ed_action -> 'constraints', '[]'::jsonb)),
      'active', v_ed.ed_max_per_action, p_max_uses, v_ed.ed_contract_expires_at, ar.contract_id
    ) returning id into v_budget;
  else
    update public.capabilities set consumed_uses = consumed_uses + p_max_uses where id = v_budget;
  end if;

  v_expires := least(now() + make_interval(secs => v_ttl), v_ed.ed_contract_expires_at);
  insert into public.capability_tokens (
    tenant_id, agent_id, task_id, credential_id, contract_id, contract_version, authorization_decision_id,
    final_decision_id, budget_capability_id, tool, operation, resource, resource_constraints, arguments_hash,
    max_uses, expires_at, token_hash, approval_request_id
  ) values (
    p_tenant_id, p_agent_id, p_task_id, p_credential_id, ar.contract_id, ar.contract_version, ar.authorization_decision_id,
    ar.final_decision_id, v_budget, ar.tool, ar.operation, ar.resource,
    jsonb_build_object('schemaVersion', 1, 'items', coalesce(v_ed.ed_action -> 'constraints', '[]'::jsonb)),
    ar.arguments_hash, p_max_uses, v_expires, p_token_hash, ar.id
  ) returning id into v_token;

  update public.runtime_approval_requests set status = 'consumed', minted_capability_id = v_token, resolved_at = coalesce(resolved_at, now())
    where id = ar.id;
  insert into public.execution_events (tenant_id, task_id, capability_id, tool_request_id, decision_id, event_type, result_status, summary,
    normalized_effect_metadata)
  values (p_tenant_id, p_task_id, v_budget, ar.tool_request_id, ar.authorization_decision_id, 'capability_issued', 'success',
    format('Capability issued for %s after approval.', p_tool),
    jsonb_build_object('schemaVersion', 1, 'phase', 'capability_issued_after_approval'));
  select cap.max_invocations - cap.consumed_uses into v_remaining from public.capabilities cap where cap.id = v_budget;
  return query select 'minted'::text, v_token, v_expires, p_max_uses, v_remaining, null::text;
end;
$fn$;
revoke all on function gateway.mint_approved_capability(uuid, uuid, uuid, uuid, uuid, text, text, jsonb, text, text, integer, text) from public;
grant execute on function gateway.mint_approved_capability(uuid, uuid, uuid, uuid, uuid, text, text, jsonb, text, text, integer, text) to authority_gateway;

create or replace function gateway.activate_task_contract_core(
  p_contract_id uuid, p_activator_principal_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_task_id uuid;
  v_status public.contract_status;
  v_ephemeral_limits jsonb;
  v_required_approvals_spec jsonb;
  v_expires_at timestamptz;
  v_existing_active_id uuid;
  v_item jsonb;
begin
  select tenant_id, task_id, contract_status, ephemeral_limits, required_approvals_spec
    into v_tenant_id, v_task_id, v_status, v_ephemeral_limits, v_required_approvals_spec
  from public.task_authority_contracts
  where id = p_contract_id;

  if v_tenant_id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;

  if v_status not in ('proposed', 'awaiting_approval') then
    raise exception 'contract is not in a state that can be activated' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.contract_activation:' || v_task_id::text, 0));

  for v_item in select * from jsonb_array_elements(coalesce(v_required_approvals_spec -> 'items', '[]'::jsonb))
  loop
    if exists (
      select 1 from public.approvals a
      where a.contract_id = p_contract_id
        and a.required_kind = (v_item ->> 'kind')::public.approval_requirement_kind
        and a.required_role is not distinct from nullif(v_item ->> 'role', '')::public.tenant_role
        and a.status <> 'approved'
    ) then
      raise exception 'a required approval is missing or was rejected (kind %, role %)',
        v_item ->> 'kind', v_item ->> 'role'
        using errcode = '23514';
    end if;
  end loop;

  if not gateway.contract_alignment_cleared(p_contract_id) then
    raise exception 'the plan has not passed task-alignment review' using errcode = '23514';
  end if;

  select id into v_existing_active_id
  from public.task_authority_contracts
  where task_id = v_task_id and contract_status = 'active' and id <> p_contract_id;

  v_expires_at := now() + make_interval(secs => (v_ephemeral_limits ->> 'expiresInSeconds')::integer);

  if v_existing_active_id is not null then
    update public.task_authority_contracts
    set contract_status = 'superseded', superseded_at = now(), superseded_by_contract_id = p_contract_id
    where id = v_existing_active_id;
  end if;

  update public.task_authority_contracts
  set contract_status = 'active', activated_at = now(), activated_by_principal_id = p_activator_principal_id,
      expires_at = v_expires_at
  where id = p_contract_id and contract_status in ('proposed', 'awaiting_approval');

  if not found then
    raise exception 'contract is not in a state that can be activated' using errcode = '23514';
  end if;

  update public.tasks
  set status = 'contract_issued', updated_at = now()
  where id = v_task_id and status = 'pending';
end;
$fn$;
revoke all on function gateway.activate_task_contract_core(uuid, uuid) from public;

drop function if exists public.raise_task_budgets(uuid, text);
drop function if exists gateway.task_action_budgets(uuid);
drop function if exists gateway.request_budget_raise_for_backend(text, uuid);
drop function if exists gateway.backfill_task_action_allowances();
drop function if exists gateway.seed_allowance_on_capability();
drop function if exists gateway.raise_task_allowances(uuid, text, uuid, uuid, text);
drop function if exists gateway.seed_task_allowances(uuid);
drop function if exists gateway.remaining_for_budget(uuid);
drop function if exists gateway.task_action_usage(uuid, text, jsonb);
drop index if exists public.capabilities_task_action_idx;

alter table public.task_action_allowances rename to task_action_allowances_rb_20261027;
alter table public.contract_budget_raise_requests rename to contract_budget_raise_requests_rb_20261027;
alter table public.task_budget_changes rename to task_budget_changes_rb_20261027;
-- Index names are relations too: rename them so re-applying the migration can recreate the originals.
alter index public.task_action_allowances_identity rename to task_action_allowances_identity_rb_20261027;
alter index public.task_action_allowances_pkey rename to task_action_allowances_pkey_rb_20261027;
alter index public.contract_budget_raise_requests_pkey rename to contract_budget_raise_requests_pkey_rb_20261027;
alter index public.task_budget_changes_pkey rename to task_budget_changes_pkey_rb_20261027;
alter index public.task_budget_changes_task_idx rename to task_budget_changes_task_idx_rb_20261027;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261023000003'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;

delete from supabase_migrations.schema_migrations where version = '20261027000001';
