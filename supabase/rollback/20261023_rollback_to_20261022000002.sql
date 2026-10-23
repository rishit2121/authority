-- ROLLBACK of migrations 20261023000001 (closed-world arguments), 20261023000002 (GitHub release refund) and
-- 20261023000003 (settlement spends a use revoked in flight).
--
-- Not a migration: it lives outside supabase/migrations so nothing applies it automatically. Run it only to return
-- the database to schema 20261022000002, in one transaction:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/rollback/20261023_rollback_to_20261022000002.sql
-- It restores, verbatim, the previous bodies of gateway.evaluate_deterministic (from 20261015000001),
-- gateway.settle_reservation (from 20260930000003), gateway.settle_connector_reservation (from 20261021000001) and
-- gateway.enforce_capability_immutable (from 20260930000001), and the schema-version probe. It changes no table and deletes no data: decisions, capabilities and receipts
-- written in the meantime stay. It also removes the three rows from the Supabase migration history, so a later
-- `supabase db push` re-applies them.
-- Rolling back also restores the defects those migrations fix (extra argument keys accepted, GitHub budget held after
-- a pre-dispatch release, a use revoked in flight refunded). Use it only when the new schema itself is the problem.
-- Tested on a throwaway local Supabase: the migrations applied, traffic served by the new code, then this script.
-- Afterwards the previous application code (8c68079) passed its full pgTAP suite, its local API suites and its
-- dashboard end-to-end tests. Contracts the new compiler wrote stay in the database; the previous code cannot read
-- them and logs "failed domain validation" for them. Re-prepare the affected tasks.

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

create or replace function gateway.settle_reservation(
  p_execution_id uuid,
  p_category text,
  p_reason_code text,
  p_github_request_id text,
  p_http_status_class smallint,
  p_resource_ids jsonb,
  p_before_sha text,
  p_after_sha text,
  p_started_at timestamptz,
  p_redaction jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  r public.capability_reservations%rowtype;
  v_decision uuid;
  v_status text;
  v_new_status text;
  v_receipt uuid;
  v_request_id uuid;
  v_spend boolean;
  v_event_type public.execution_event_type;
  v_event_result public.execution_outcome;
  v_cap_status text;
begin
  select * into r from public.capability_reservations where id = p_execution_id;
  if r.id is null or r.status <> 'reserved' then
    raise exception 'reservation is not open' using errcode = '55000';
  end if;

  v_new_status := case p_category
    when 'succeeded' then 'consumed'
    when 'succeeded_noop' then 'consumed'
    when 'failed' then 'failed'
    when 'indeterminate' then 'indeterminate'
    when 'released' then 'released'
  end;
  if v_new_status is null then raise exception 'unknown result category' using errcode = '22023'; end if;
  if p_category = 'released' and r.dispatched_at is not null then
    raise exception 'a dispatched execution cannot be released' using errcode = '55000';
  end if;
  if p_category <> 'released' and r.dispatched_at is null then
    raise exception 'an undispatched execution can only be released' using errcode = '55000';
  end if;
  v_spend := p_category <> 'released';

  select ct.authorization_decision_id, ct.status into v_decision, v_cap_status
  from public.capability_tokens ct where ct.id = r.capability_id;

  insert into public.github_execution_receipts (
    tenant_id, execution_id, task_id, agent_id, capability_id, authorization_decision_id, installation_row_id,
    github_installation_id, repository_id, repository_full_name, tool, operation, request_hash, execution_mode,
    result_category, github_request_id, http_status_class, resource_ids, before_sha, after_sha,
    started_at, finished_at, redaction_metadata, reason_code
  ) values (
    r.tenant_id, r.id, r.task_id, r.agent_id, r.capability_id, v_decision, r.installation_row_id,
    r.github_installation_id, r.repository_id, r.repository_full_name, r.tool, r.operation, r.request_hash, r.execution_mode,
    p_category, p_github_request_id, p_http_status_class,
    coalesce(p_resource_ids, '{"schemaVersion":1}'::jsonb), p_before_sha, p_after_sha,
    least(coalesce(p_started_at, r.reserved_at), now()), now(), coalesce(p_redaction, '{"schemaVersion":1}'::jsonb), p_reason_code
  ) returning id into v_receipt;

  update public.capability_reservations
    set status = v_new_status, finished_at = now(), reason_code = p_reason_code
    where id = r.id;

  if v_cap_status = 'revoked' then
    -- A revoked capability is frozen; only the reservation hold is released.
    update public.capability_tokens set reserved_uses = reserved_uses - 1 where id = r.capability_id;
  elsif v_spend then
    update public.capability_tokens
      set reserved_uses = reserved_uses - 1,
          uses = uses + 1,
          status = case when uses + 1 >= max_uses then 'consumed' else status end
      where id = r.capability_id;
  else
    update public.capability_tokens set reserved_uses = reserved_uses - 1 where id = r.capability_id;
  end if;
  perform gateway.release_unused_budget(r.capability_id);

  select d.tool_request_id into v_request_id
  from public.authorization_decisions d where d.id = v_decision;

  v_event_type := case when p_category in ('succeeded', 'succeeded_noop') then 'tool_invoked' else 'tool_failed' end;
  v_event_result := case p_category
    when 'succeeded' then 'success' when 'succeeded_noop' then 'success'
    when 'released' then 'info' else 'failure' end;
  insert into public.execution_events (
    tenant_id, task_id, tool_request_id, decision_id, event_type, result_status, summary,
    normalized_effect_metadata, receipt_metadata
  ) values (
    r.tenant_id, r.task_id, v_request_id, v_decision, v_event_type, v_event_result,
    format('%s GitHub %s (%s): %s', case r.execution_mode when 'live' then 'LIVE' else 'MOCK' end, r.tool, p_category,
      coalesce(p_reason_code, 'ok')),
    jsonb_build_object('schemaVersion', 1, 'phase', p_category, 'mode', r.execution_mode, 'executionId', r.id),
    jsonb_build_object('schemaVersion', 1, 'receiptId', v_receipt)
  );
  return v_receipt;
end;
$fn$;
revoke all on function gateway.settle_reservation(uuid, text, text, text, smallint, jsonb, text, text, timestamptz, jsonb) from public;
grant execute on function gateway.settle_reservation(uuid, text, text, text, smallint, jsonb, text, text, timestamptz, jsonb) to authority_gateway;

create or replace function gateway.settle_connector_reservation(
  p_execution_id uuid,
  p_category text,
  p_reason_code text,
  p_provider_request_id text,
  p_http_status_class smallint,
  p_resource_ids jsonb,
  p_started_at timestamptz,
  p_redaction jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  r public.connector_reservations%rowtype;
  v_decision uuid;
  v_new_status text;
  v_receipt uuid;
  v_request_id uuid;
  v_spend boolean;
  v_event_type public.execution_event_type;
  v_event_result public.execution_outcome;
  v_cap_status text;
begin
  select * into r from public.connector_reservations where id = p_execution_id;
  if r.id is null or r.status <> 'reserved' then
    raise exception 'reservation is not open' using errcode = '55000';
  end if;

  v_new_status := case p_category
    when 'succeeded' then 'consumed'
    when 'succeeded_noop' then 'consumed'
    when 'failed' then 'failed'
    when 'indeterminate' then 'indeterminate'
    when 'released' then 'released'
  end;
  if v_new_status is null then raise exception 'unknown result category' using errcode = '22023'; end if;
  if p_category = 'released' and r.dispatched_at is not null then
    raise exception 'a dispatched execution cannot be released' using errcode = '55000';
  end if;
  if p_category <> 'released' and r.dispatched_at is null then
    raise exception 'an undispatched execution can only be released' using errcode = '55000';
  end if;
  v_spend := p_category <> 'released';

  select ct.authorization_decision_id, ct.status into v_decision, v_cap_status
  from public.capability_tokens ct where ct.id = r.capability_id;

  insert into public.connector_execution_receipts (
    tenant_id, execution_id, task_id, agent_id, capability_id, authorization_decision_id, connector_id,
    connection_id, tool, operation, resource, request_hash, execution_mode,
    result_category, provider_request_id, http_status_class, resource_ids,
    started_at, finished_at, redaction_metadata, reason_code
  ) values (
    r.tenant_id, r.id, r.task_id, r.agent_id, r.capability_id, v_decision, r.connector_id,
    r.connection_id, r.tool, r.operation, r.resource, r.request_hash, r.execution_mode,
    p_category, p_provider_request_id, p_http_status_class,
    coalesce(p_resource_ids, '{"schemaVersion":1}'::jsonb),
    least(coalesce(p_started_at, r.reserved_at), now()), now(), coalesce(p_redaction, '{"schemaVersion":1}'::jsonb), p_reason_code
  ) returning id into v_receipt;

  update public.connector_reservations
    set status = v_new_status, finished_at = now(), reason_code = p_reason_code
    where id = r.id;

  if v_cap_status = 'revoked' then
    update public.capability_tokens set reserved_uses = reserved_uses - 1 where id = r.capability_id;
  elsif v_spend then
    update public.capability_tokens
      set reserved_uses = reserved_uses - 1,
          uses = uses + 1,
          status = case when uses + 1 >= max_uses then 'consumed' else status end
      where id = r.capability_id;
  else
    update public.capability_tokens set reserved_uses = reserved_uses - 1 where id = r.capability_id;
    -- Definitely never dispatched (a pre-dispatch refusal, a dispatch-time block, or a lease that expired
    -- before dispatch). For a single-use capability with nothing else in flight, retire it so its one use
    -- returns to the step's budget (release_unused_budget below, exactly once) and the agent can be
    -- authorized again. A dispatched, failed or indeterminate execution still spends; a capability with
    -- other uses or reservations keeps today's behaviour, so concurrent uses are never cut off.
    update public.capability_tokens
      set status = 'revoked', revoked_at = now(), revoked_by = 'system',
          revocation_reason = left('released before dispatch: ' || coalesce(p_reason_code, 'unknown'), 500)
      where id = r.capability_id and status = 'active' and max_uses = 1 and uses = 0 and reserved_uses = 0;
  end if;
  perform gateway.release_unused_budget(r.capability_id);

  select d.tool_request_id into v_request_id
  from public.authorization_decisions d where d.id = v_decision;

  v_event_type := case when p_category in ('succeeded', 'succeeded_noop') then 'tool_invoked' else 'tool_failed' end;
  v_event_result := case p_category
    when 'succeeded' then 'success' when 'succeeded_noop' then 'success'
    when 'released' then 'info' else 'failure' end;
  insert into public.execution_events (
    tenant_id, task_id, tool_request_id, decision_id, event_type, result_status, summary,
    normalized_effect_metadata, receipt_metadata
  ) values (
    r.tenant_id, r.task_id, v_request_id, v_decision, v_event_type, v_event_result,
    format('%s %s %s (%s): %s', case r.execution_mode when 'live' then 'LIVE' else 'MOCK' end, r.connector_id, r.tool, p_category,
      coalesce(p_reason_code, 'ok')),
    jsonb_build_object('schemaVersion', 1, 'phase', p_category, 'mode', r.execution_mode, 'executionId', r.id),
    jsonb_build_object('schemaVersion', 1, 'receiptId', v_receipt)
  );
  return v_receipt;
end;
$fn$;
revoke all on function gateway.settle_connector_reservation(uuid, text, text, text, smallint, jsonb, timestamptz, jsonb) from public;
grant execute on function gateway.settle_connector_reservation(uuid, text, text, text, smallint, jsonb, timestamptz, jsonb) to authority_gateway;

create or replace function gateway.enforce_capability_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('authority.allow_demo_purge', true) = 'on' then return old; end if;
    raise exception 'capability tokens cannot be deleted' using errcode = '23514';
  end if;

  if (new.id, new.tenant_id, new.agent_id, new.task_id, new.credential_id, new.contract_id, new.contract_version,
      new.authorization_decision_id, new.final_decision_id, new.budget_capability_id, new.tool, new.operation,
      new.resource, new.resource_constraints, new.arguments_hash, new.max_uses, new.issued_at, new.expires_at,
      new.token_hash, new.format_version)
     is distinct from
     (old.id, old.tenant_id, old.agent_id, old.task_id, old.credential_id, old.contract_id, old.contract_version,
      old.authorization_decision_id, old.final_decision_id, old.budget_capability_id, old.tool, old.operation,
      old.resource, old.resource_constraints, old.arguments_hash, old.max_uses, old.issued_at, old.expires_at,
      old.token_hash, old.format_version) then
    raise exception 'a capability''s binding is immutable' using errcode = '23514';
  end if;

  if new.uses < old.uses then
    raise exception 'capability uses can only increase' using errcode = '23514';
  end if;
  if new.budget_released_uses < old.budget_released_uses then
    raise exception 'released budget can only increase' using errcode = '23514';
  end if;
  if old.status in ('consumed', 'revoked') and new.status is distinct from old.status then
    raise exception 'a % capability cannot change status', old.status using errcode = '23514';
  end if;
  if old.status = 'revoked' and (new.revoked_at, new.revoked_by, new.revocation_reason, new.uses)
       is distinct from (old.revoked_at, old.revoked_by, old.revocation_reason, old.uses) then
    raise exception 'a revoked capability is frozen' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261022000002'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;

delete from supabase_migrations.schema_migrations where version in ('20261023000001', '20261023000002', '20261023000003');
