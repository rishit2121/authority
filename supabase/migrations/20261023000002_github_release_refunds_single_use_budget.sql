-- GitHub execution parity: an execution that was definitely never dispatched returns the step's budget (issue #59).
--
-- 20261021000001 made the generic connector path (gateway.settle_connector_reservation) retire a single-use
-- capability released before dispatch, so release_unused_budget refunds its use to the step's budget. The GitHub
-- path (gateway.settle_reservation, used by src/lib/github/executor.ts and by reconcile_capability for expired
-- leases) was left unchanged: a released GitHub execution returned the use to the token but kept the step's budget
-- held, so a fresh authorize for the same step was refused with INVOCATION_LIMIT_REACHED until the token expired.
-- This applies the same retire-and-refund. The function body is otherwise 20260930000003's.

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
    -- Definitely never dispatched (a pre-dispatch refusal such as REPOSITORY_MISMATCH, ARGUMENTS_INVALID or
    -- TOKEN_MINT_FAILED, or a lease that expired before dispatch). Same rule as the generic connector path
    -- (20261021000001): a single-use capability with nothing else in flight is retired, so release_unused_budget
    -- below returns its one use to the step's budget exactly once and the agent can be authorized again.
    -- Dispatched, failed and indeterminate executions still spend; multi-use or busy capabilities are unchanged.
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

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261023000002'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
