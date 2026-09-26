-- Corrective, found by running 17_runtime_authorization.sql against the
-- real deployed schema: the final `insert into authorization_decisions`
-- and the closing `return query select` both referenced `v_contract.id`/
-- `v_contract.version` inside `case when v_found_contract then ... else
-- null end` expressions. v_contract is a plain `record` with no declared
-- row type, and PL/pgSQL must know a record's structure to plan any SQL
-- statement that dot-references it — even inside a branch that will not be
-- taken at runtime — so the very first call down the "no contract has ever
-- been proposed for this task" path (where the `select ... into v_contract`
-- earlier in the function never runs) failed with "record is not assigned
-- yet" (55000), regardless of short-circuit evaluation. Fixed by copying
-- the two scalar fields this function actually needs into ordinary
-- variables at the one point v_contract is known to be populated, and
-- referencing those instead. No other behavior changes.

-- Corrective, found by running 17_runtime_authorization.sql against the
-- real deployed schema: authorize_tool_call() declares OUT parameters named
-- `outcome` and `contract_id` (see its RETURNS TABLE clause), which are
-- visible as plain identifiers throughout the function body. Three bare
-- column references — agent_auth_events.outcome in the rate-limit count,
-- and capabilities.contract_id in both budget lookups — collided with
-- those OUT parameter names and raised "column reference is ambiguous"
-- (42702) the first time either code path actually ran. Fixed by aliasing
-- both tables and qualifying every reference. No other behavior changes.

create or replace function public.authorize_tool_call(
  p_credential_secret text,
  p_task_id uuid,
  p_tool text,
  p_operation text,
  p_resource text,
  p_arguments jsonb,
  p_plan_node_id uuid,
  p_idempotency_key text,
  p_execution_context jsonb,
  p_current_registry_version text,
  p_current_compiler_version text
)
returns table (
  decision_id uuid,
  tool_request_id uuid,
  outcome public.authorization_outcome,
  reason_codes text[],
  contract_id uuid,
  contract_version integer,
  remaining_invocations integer,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_attempted_prefix text;
  v_recent_failures integer;
  v_hash text;
  v_cred record;
  v_tenant_id uuid;
  v_agent_id uuid;
  v_task record;
  v_existing record;
  v_request_hash text;
  v_reason_items jsonb := '[]'::jsonb;
  v_outcome public.authorization_outcome;
  v_contract record;
  v_found_contract boolean := false;
  v_contract_id uuid;
  v_contract_version integer;
  v_action jsonb;
  v_constraint jsonb;
  v_key text;
  v_arg_raw jsonb;
  v_arg_value text;
  v_ok boolean;
  v_total_failing integer := 0;
  v_missing_failing integer := 0;
  v_candidates text[];
  v_forbidden_pattern text;
  v_hit_forbidden boolean;
  v_used_total integer;
  v_max_total integer;
  v_max_per_action integer;
  v_existing_capability record;
  v_will_reserve boolean := false;
  v_capability_id uuid;
  v_remaining integer;
  v_tool_request_id uuid;
  v_decision_id uuid;
  v_result_status public.execution_outcome;
begin
  if p_credential_secret is null or char_length(p_credential_secret) < 10 then
    raise exception 'malformed runtime credential' using errcode = '28000';
  end if;
  if p_tool is null or p_tool !~ '^[a-z0-9_]+\.[a-z0-9_]+$' then
    raise exception 'malformed tool identifier' using errcode = '22023';
  end if;
  if p_operation is null or char_length(btrim(p_operation)) < 1 then
    raise exception 'operation is required' using errcode = '22023';
  end if;
  if p_current_registry_version is null or p_current_compiler_version is null then
    raise exception 'current registry and compiler versions are required' using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 1 or char_length(p_idempotency_key) > 200 then
    raise exception 'idempotency key is required and must be 1-200 characters' using errcode = '22023';
  end if;

  v_attempted_prefix := left(p_credential_secret, 21);

  select count(*) into v_recent_failures
  from public.agent_auth_events aae
  where aae.attempted_key_prefix = v_attempted_prefix
    and aae.outcome in ('invalid_credential', 'rate_limited')
    and aae.created_at > now() - interval '60 seconds';

  if v_recent_failures >= 20 then
    insert into public.agent_auth_events (attempted_key_prefix, outcome) values (v_attempted_prefix, 'rate_limited');
    raise exception 'too many failed authentication attempts for this credential; slow down' using errcode = '53400';
  end if;

  v_hash := encode(extensions.digest(p_credential_secret, 'sha256'), 'hex');
  select * into v_cred from public.agent_credentials where key_hash = v_hash;

  if v_cred.id is null then
    insert into public.agent_auth_events (attempted_key_prefix, outcome) values (v_attempted_prefix, 'invalid_credential');
    raise exception 'invalid runtime credential' using errcode = '28000';
  end if;

  if v_cred.status <> 'active' then
    insert into public.agent_auth_events (tenant_id, agent_id, credential_id, attempted_key_prefix, outcome)
      values (v_cred.tenant_id, v_cred.agent_id, v_cred.id, v_attempted_prefix, 'revoked_credential');
    raise exception 'runtime credential has been revoked' using errcode = '28000';
  end if;

  v_tenant_id := v_cred.tenant_id;
  v_agent_id := v_cred.agent_id;

  update public.agent_credentials set last_used_at = now() where id = v_cred.id;
  insert into public.agent_auth_events (tenant_id, agent_id, credential_id, attempted_key_prefix, outcome)
    values (v_tenant_id, v_agent_id, v_cred.id, v_attempted_prefix, 'success');

  select * into v_task from public.tasks where id = p_task_id and tenant_id = v_tenant_id;
  if v_task.id is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if v_task.agent_id <> v_agent_id then
    raise exception 'this credential is not bound to the requesting agent for this task' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.runtime_authorize:' || p_task_id::text, 0));

  v_request_hash := encode(extensions.digest(
    coalesce(p_tool, '') || '|' || coalesce(p_operation, '') || '|' || coalesce(p_resource, '') || '|' ||
    coalesce(p_arguments::text, '{}') || '|' || coalesce(p_plan_node_id::text, ''),
    'sha256'), 'hex');

  select tr.id, tr.request_hash into v_existing
  from public.tool_requests tr
  where tr.tenant_id = v_tenant_id and tr.task_id = p_task_id and tr.idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    if v_existing.request_hash is distinct from v_request_hash then
      raise exception 'idempotency key % was already used for this task with different content', p_idempotency_key
        using errcode = '23505';
    end if;

    return query
      select
        d.id,
        d.tool_request_id,
        d.outcome,
        array(select item ->> 'code' from jsonb_array_elements(d.reason_codes -> 'items') item),
        d.contract_id,
        d.contract_version,
        case when cap.id is not null then cap.max_invocations - cap.consumed_uses else null end,
        true
      from public.authorization_decisions d
      left join public.capabilities cap on cap.id = d.capability_id
      where d.tool_request_id = v_existing.id;
    return;
  end if;

  insert into public.tool_requests (
    tenant_id, task_id, plan_id, plan_node_id, agent_id, tool, operation, resource,
    normalized_arguments, destination_metadata, provenance, idempotency_key, request_hash
  ) values (
    v_tenant_id, p_task_id, null, p_plan_node_id, v_agent_id, p_tool, p_operation, p_resource,
    jsonb_build_object('schemaVersion', 1, 'values', coalesce(p_arguments, '{}'::jsonb)),
    case when p_execution_context is null then null
         else jsonb_build_object('schemaVersion', 1, 'executionContext', p_execution_context) end,
    'agent_proposed', p_idempotency_key, v_request_hash
  )
  returning id into v_tool_request_id;

  if v_task.status not in ('contract_issued', 'executing') then
    v_reason_items := jsonb_build_array(jsonb_build_object(
      'code', 'TASK_NOT_EXECUTABLE',
      'detail', format('Task status is "%s"; runtime calls require contract_issued or executing.', v_task.status),
      'source', 'policy'
    ));
    v_outcome := 'deny';

  else
    select * into v_contract
    from public.task_authority_contracts
    where task_id = p_task_id and contract_status = 'active';
    v_found_contract := v_contract.id is not null;
    if v_found_contract then
      v_contract_id := v_contract.id;
      v_contract_version := v_contract.version;
    end if;

    if not v_found_contract then
      v_reason_items := jsonb_build_array(jsonb_build_object(
        'code', 'NO_ACTIVE_CONTRACT',
        'detail', 'No task authority contract is currently active for this task.',
        'source', 'contract'
      ));
      v_outcome := 'deny';

    elsif not authz.contract_is_currently_active(v_contract.contract_status, v_contract.expires_at) then
      v_reason_items := jsonb_build_array(jsonb_build_object(
        'code', 'CONTRACT_NOT_CURRENTLY_ACTIVE',
        'detail', 'The active contract is expired; it has not yet been reconciled.',
        'source', 'contract'
      ));
      v_outcome := 'deny';

    elsif v_contract.registry_version is distinct from p_current_registry_version
       or v_contract.compiler_version is distinct from p_current_compiler_version then
      v_reason_items := jsonb_build_array(jsonb_build_object(
        'code', 'UNSUPPORTED_CONTRACT_VERSION',
        'detail', 'The contract was compiled against a registry or compiler version no longer supported.',
        'source', 'contract'
      ));
      v_outcome := 'deny';

    else
      select array_agg(lower(cand)) into v_candidates
      from (
        select p_tool as cand
        union all
        select case when jsonb_typeof(value) = 'string' then value #>> '{}' else value::text end
        from jsonb_each(coalesce(p_arguments, '{}'::jsonb))
      ) c(cand);

      v_hit_forbidden := false;
      for v_forbidden_pattern in select unnest(v_contract.forbidden_resources) loop
        if exists (select 1 from unnest(v_candidates) cand where authz.glob_match(v_forbidden_pattern, cand)) then
          v_hit_forbidden := true;
          exit;
        end if;
      end loop;

      if v_hit_forbidden then
        v_reason_items := jsonb_build_array(jsonb_build_object(
          'code', 'FORBIDDEN_RESOURCE',
          'detail', format('Request matches the contract''s forbidden resource pattern "%s".', v_forbidden_pattern),
          'source', 'policy'
        ));
        v_outcome := 'deny';

      elsif p_tool = any(v_contract.forbidden_operations) then
        v_reason_items := jsonb_build_array(jsonb_build_object(
          'code', 'FORBIDDEN_OPERATION',
          'detail', format('"%s" is an exact operation denied by an active policy.', p_tool),
          'source', 'policy'
        ));
        v_outcome := 'deny';

      else
        select item into v_action
        from jsonb_array_elements(v_contract.allowed_actions -> 'items') item
        where item ->> 'tool' = p_tool
        limit 1;

        if v_action is null then
          v_reason_items := jsonb_build_array(jsonb_build_object(
            'code', 'TOOL_NOT_IN_CONTRACT',
            'detail', format('"%s" is not an allowed action on this task authority contract.', p_tool),
            'source', 'contract'
          ));
          v_outcome := 'replan';

        else
          v_total_failing := 0;
          v_missing_failing := 0;
          for v_constraint in select value from jsonb_array_elements(coalesce(v_action -> 'constraints', '[]'::jsonb))
          loop
            v_key := v_constraint ->> 'key';
            v_arg_raw := p_arguments -> v_key;
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
            v_reason_items := jsonb_build_array(jsonb_build_object(
              'code', 'ARGUMENTS_UNDERSPECIFIED',
              'detail', 'One or more constrained arguments are missing from the request.',
              'source', 'contract'
            ));
            v_outcome := 'clarify';

          elsif v_total_failing > 0 then
            v_reason_items := jsonb_build_array(jsonb_build_object(
              'code', 'CONSTRAINT_VIOLATION',
              'detail', 'Arguments fall outside the contract''s constraints for this action.',
              'source', 'contract'
            ));
            v_outcome := 'deny';

          else
            select coalesce(sum(cap.consumed_uses), 0) into v_used_total
            from public.capabilities cap where cap.contract_id = v_contract.id;
            v_max_total := (v_contract.ephemeral_limits ->> 'maxToolInvocations')::integer;

            select * into v_existing_capability
            from public.capabilities cap where cap.contract_id = v_contract.id and cap.tool = p_tool;
            v_max_per_action := coalesce((v_action ->> 'maxInvocations')::integer, v_max_total);

            if v_used_total >= v_max_total then
              v_reason_items := jsonb_build_array(jsonb_build_object(
                'code', 'INVOCATION_LIMIT_REACHED',
                'detail', format('Task exhausted its %s-invocation contract-wide budget.', v_max_total),
                'source', 'limit'
              ));
              v_outcome := 'deny';

            elsif v_existing_capability.id is not null and v_existing_capability.consumed_uses >= v_existing_capability.max_invocations then
              v_reason_items := jsonb_build_array(jsonb_build_object(
                'code', 'INVOCATION_LIMIT_REACHED',
                'detail', format('"%s" exhausted its own %s-invocation budget.', p_tool, v_existing_capability.max_invocations),
                'source', 'limit'
              ));
              v_outcome := 'deny';

            else
              v_reason_items := jsonb_build_array(jsonb_build_object(
                'code', 'WITHIN_CONTRACT',
                'detail', format('"%s" is permitted and its arguments satisfy every contract constraint.', p_tool),
                'source', 'contract'
              ));
              v_outcome := case when jsonb_array_length(coalesce(v_action -> 'constraints', '[]'::jsonb)) > 0
                                then 'allow_constrained' else 'allow' end;
              v_will_reserve := true;
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;

  insert into public.authorization_decisions (
    tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome, reason_codes, latency_ms
  ) values (
    v_tenant_id, p_task_id, v_tool_request_id,
    v_contract_id,
    v_contract_version,
    v_outcome,
    jsonb_build_object('schemaVersion', 1, 'items', v_reason_items),
    0
  )
  returning id into v_decision_id;

  if v_will_reserve then
    if v_existing_capability.id is null then
      insert into public.capabilities (
        tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
        status, max_invocations, consumed_uses, expires_at, contract_id
      ) values (
        v_tenant_id, p_task_id, v_decision_id, v_agent_id, p_tool,
        jsonb_build_object('schemaVersion', 1, 'items', coalesce(v_action -> 'constraints', '[]'::jsonb)),
        'active', v_max_per_action, 1, v_contract.expires_at, v_contract.id
      )
      returning id into v_capability_id;

      insert into public.execution_events (
        tenant_id, task_id, capability_id, tool_request_id, decision_id, event_type, result_status, summary
      ) values (
        v_tenant_id, p_task_id, v_capability_id, v_tool_request_id, v_decision_id, 'capability_issued', 'success',
        format('Capability issued for %s under contract version %s.', p_tool, v_contract.version)
      );
    else
      update public.capabilities
      set consumed_uses = consumed_uses + 1
      where id = v_existing_capability.id
      returning id into v_capability_id;
    end if;

    update public.authorization_decisions set capability_id = v_capability_id where id = v_decision_id;
  end if;

  v_result_status := case when v_outcome in ('allow', 'allow_constrained') then 'success' else 'blocked' end;

  insert into public.execution_events (
    tenant_id, task_id, capability_id, tool_request_id, decision_id, event_type, result_status, summary
  ) values (
    v_tenant_id, p_task_id, v_capability_id, v_tool_request_id, v_decision_id, 'request_evaluated', v_result_status,
    format('Runtime call to %s evaluated as %s.', p_tool, v_outcome)
  );

  if v_capability_id is not null then
    select max_invocations - consumed_uses into v_remaining from public.capabilities where id = v_capability_id;
  else
    v_remaining := null;
  end if;

  return query select
    v_decision_id, v_tool_request_id, v_outcome,
    array(select item ->> 'code' from jsonb_array_elements(v_reason_items) item),
    v_contract_id,
    v_contract_version,
    v_remaining,
    false;
end;
$fn$;
