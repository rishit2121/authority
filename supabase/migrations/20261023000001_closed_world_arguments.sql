-- Closed-world arguments at authorization.
--
-- Before this, gateway.evaluate_deterministic checked only the keys an allowed action pinned; any other argument
-- key was accepted with whatever value the agent chose. So an optional field the plan never set (a pull request's
-- head_branch, a mailbox query, an optional account id on a published Custom API operation) was effectively
-- unconstrained. The compiler (authority-compiler-2026-10-23-9) now emits `openArguments` on every action: the
-- free-text fields the plan left open. This evaluator then refuses any supplied key that is neither pinned nor open.
--
-- Unchanged otherwise: the function body below is 20261015000001's, with only the block marked "Closed-world
-- arguments" and the v_undeclared variable added.

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

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261023000001'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
