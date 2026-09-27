-- Part 7: two-phase capability consumption (reserve -> dispatch -> settle),
-- lazy lease reconciliation, and release of unused budget.
--
-- Invariant (also a CHECK): uses + reserved_uses + budget_released_uses <= max_uses.
--   uses               spent: consumed, failed, indeterminate
--   reserved_uses      held by an in-flight reservation
--   budget_released_uses  returned to the per-contract budget on expiry/revocation

-- Real (connector) attempts may be recorded as rejections; only simulated rows
-- may be "accepted" here — an accepted real use lives in capability_reservations.
alter table public.capability_consumptions drop constraint consumption_simulated_only;
alter table public.capability_consumptions
  add constraint consumption_real_rows_are_rejections_only check (simulated or result = 'rejected');

-- ---------------------------------------------------------------------------
-- Connector-executable tools: fixed in code and mirrored here so the database
-- refuses to reserve anything the connector could not run. Adding a tool is a
-- deliberate migration.
-- ---------------------------------------------------------------------------
create or replace function gateway.is_connector_tool(p_tool text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tool in (
    'github.get_issue', 'github.read_repository', 'github.create_branch',
    'github.put_file', 'github.create_pull_request', 'github.get_pull_request'
  );
$$;
revoke all on function gateway.is_connector_tool(text) from public;
grant execute on function gateway.is_connector_tool(text) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Unused budget: a capability that expired or was revoked without using all
-- its uses hands the remainder back to the per-contract budget, exactly once.
-- ---------------------------------------------------------------------------
create or replace function gateway.release_unused_budget(p_capability_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_budget uuid;
  v_unused integer;
  v_status text;
  v_expires timestamptz;
begin
  select ct.budget_capability_id, ct.max_uses - ct.uses - ct.reserved_uses - ct.budget_released_uses, ct.status, ct.expires_at
    into v_budget, v_unused, v_status, v_expires
  from public.capability_tokens ct where ct.id = p_capability_id for update;
  if v_budget is null or v_unused <= 0 then return 0; end if;
  if not (v_status = 'revoked' or v_expires <= now()) then return 0; end if;
  update public.capabilities set consumed_uses = greatest(consumed_uses - v_unused, 0) where id = v_budget;
  update public.capability_tokens set budget_released_uses = budget_released_uses + v_unused where id = p_capability_id;
  return v_unused;
end;
$fn$;
revoke all on function gateway.release_unused_budget(uuid) from public;
grant execute on function gateway.release_unused_budget(uuid) to authority_gateway;

create or replace function gateway.sweep_task_budgets(p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_cap uuid;
  v_total integer := 0;
begin
  for v_cap in
    select ct.id from public.capability_tokens ct
    where ct.task_id = p_task_id and ct.max_uses - ct.uses - ct.reserved_uses - ct.budget_released_uses > 0
      and (ct.status = 'revoked' or ct.expires_at <= now())
    order by ct.id limit 50
  loop
    perform pg_advisory_xact_lock(hashtextextended('authority.capability:' || v_cap::text, 0));
    v_total := v_total + gateway.release_unused_budget(v_cap);
  end loop;
  return v_total;
end;
$fn$;
revoke all on function gateway.sweep_task_budgets(uuid) from public;
grant execute on function gateway.sweep_task_budgets(uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- The single place a reservation leaves 'reserved'. Caller holds the
-- capability lock. Writes the receipt, settles the capability counters and
-- records the trace event, atomically.
-- ---------------------------------------------------------------------------
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

-- Expired leases: never dispatched -> released; dispatched -> indeterminate
-- (the write may have happened; it is never retried automatically).
create or replace function gateway.reconcile_capability(p_capability_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_res public.capability_reservations%rowtype;
  v_n integer := 0;
begin
  for v_res in
    select * from public.capability_reservations
    where capability_id = p_capability_id and status = 'reserved' and lease_expires_at <= now()
    order by reserved_at
  loop
    perform gateway.settle_reservation(
      v_res.id,
      case when v_res.dispatched_at is null then 'released' else 'indeterminate' end,
      case when v_res.dispatched_at is null then 'LEASE_EXPIRED_BEFORE_DISPATCH' else 'LEASE_EXPIRED_AFTER_DISPATCH' end,
      null, null, null, null, null, v_res.dispatched_at, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;
revoke all on function gateway.reconcile_capability(uuid) from public;
grant execute on function gateway.reconcile_capability(uuid) to authority_gateway;

-- Sweep for a scheduler / readiness probe: reconciles across tenants.
create or replace function gateway.reconcile_expired_reservations(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_cap uuid;
  v_n integer := 0;
begin
  for v_cap in
    select distinct r.capability_id from public.capability_reservations r
    where r.status = 'reserved' and r.lease_expires_at <= now() limit greatest(least(coalesce(p_limit, 50), 500), 1)
  loop
    perform pg_advisory_xact_lock(hashtextextended('authority.capability:' || v_cap::text, 0));
    v_n := v_n + gateway.reconcile_capability(v_cap);
  end loop;
  return v_n;
end;
$fn$;
revoke all on function gateway.reconcile_expired_reservations(integer) from public;
grant execute on function gateway.reconcile_expired_reservations(integer) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Shared liveness check used at reservation AND again immediately before
-- dispatch. Returns a reason code, or null when everything is still valid.
-- ---------------------------------------------------------------------------
create or replace function gateway.execution_blocker(p_capability_id uuid, p_repository_id uuid, p_installation_row_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_tenant uuid; v_task uuid; v_agent uuid; v_cred uuid; v_contract uuid; v_version integer; v_status text; v_resource text;
  v_c_status public.contract_status; v_c_expires timestamptz; v_c_version integer;
  v_task_status public.task_status;
  v_agent_status public.agent_status;
  v_cred_status public.agent_credential_status;
  v_repo record;
begin
  select ct.tenant_id, ct.task_id, ct.agent_id, ct.credential_id, ct.contract_id, ct.contract_version, ct.status, ct.resource
    into v_tenant, v_task, v_agent, v_cred, v_contract, v_version, v_status, v_resource
  from public.capability_tokens ct where ct.id = p_capability_id;
  if v_status = 'revoked' then return 'CAPABILITY_REVOKED'; end if;

  select c.contract_status, c.expires_at, c.version into v_c_status, v_c_expires, v_c_version
  from public.task_authority_contracts c where c.id = v_contract and c.tenant_id = v_tenant;
  if v_c_status is null or not authz.contract_is_currently_active(v_c_status, v_c_expires) or v_c_version <> v_version then
    return 'CONTRACT_NO_LONGER_ACTIVE';
  end if;
  select t.status into v_task_status from public.tasks t where t.id = v_task and t.tenant_id = v_tenant;
  if v_task_status is null or v_task_status not in ('contract_issued', 'executing') then return 'TASK_NO_LONGER_EXECUTABLE'; end if;
  select ag.status into v_agent_status from public.agents ag where ag.id = v_agent and ag.tenant_id = v_tenant;
  select ac.status into v_cred_status from public.agent_credentials ac where ac.id = v_cred and ac.tenant_id = v_tenant;
  if v_agent_status is distinct from 'active'::public.agent_status
     or v_cred_status is distinct from 'active'::public.agent_credential_status then
    return 'AGENT_OR_KEY_REVOKED';
  end if;

  if not exists (select 1 from public.task_repository_bindings b
                 where b.task_id = v_task and b.tenant_id = v_tenant and b.repository_id = p_repository_id) then
    return 'REPOSITORY_NOT_BOUND';
  end if;
  select r.present, r.allowed, r.archived, r.full_name_lc, r.installation_row_id, gi.status as inst_status
    into v_repo
  from public.github_repositories r
  join public.github_installations gi on gi.id = r.installation_row_id and gi.tenant_id = r.tenant_id
  where r.id = p_repository_id and r.tenant_id = v_tenant;
  if v_repo.full_name_lc is null then return 'REPOSITORY_NOT_ALLOWED'; end if;
  if not v_repo.present or not v_repo.allowed or v_repo.archived then return 'REPOSITORY_NOT_ALLOWED'; end if;
  if v_repo.installation_row_id is distinct from p_installation_row_id or v_repo.inst_status <> 'active' then
    return 'INSTALLATION_UNAVAILABLE';
  end if;
  if lower(coalesce(v_resource, '')) <> v_repo.full_name_lc then return 'REPOSITORY_NOT_BOUND'; end if;
  return null;
end;
$fn$;
revoke all on function gateway.execution_blocker(uuid, uuid, uuid) from public;
grant execute on function gateway.execution_blocker(uuid, uuid, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Phase 1: reserve. Everything consume_capability checks, plus the GitHub
-- context (binding, allowlist, installation health), atomically under the
-- capability lock. Concurrent reservations for the last use cannot both win.
-- ---------------------------------------------------------------------------
create or replace function gateway.reserve_execution(
  p_credential_secret text,
  p_token_hash text,
  p_tool text,
  p_operation text,
  p_resource text,
  p_args jsonb,
  p_idempotency_key text,
  p_execution_mode text,
  p_lease_seconds integer
)
returns table (
  rs_status text,
  rs_result text,
  rs_reason_code text,
  rs_execution_id uuid,
  rs_capability_id uuid,
  rs_task_id uuid,
  rs_agent_id uuid,
  rs_github_installation_id bigint,
  rs_repository text,
  rs_default_branch text,
  rs_lease_expires_at timestamptz,
  rs_prev_category text,
  rs_prev_receipt jsonb
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_agent uuid;
  v_cap uuid; v_task uuid; v_resource text; v_constraints jsonb; v_args_hash_expected text;
  v_max integer; v_uses integer; v_reserved integer; v_expires timestamptz; v_cap_status text; v_tool text; v_op text;
  v_args_hash text; v_request_hash text;
  v_prev record;
  v_reason text;
  v_repo_id uuid; v_inst_row uuid; v_gh_inst bigint; v_full_name text; v_default_branch text; v_inst_mode text;
  v_recent_rejects integer;
  v_exec uuid;
  v_lease timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'malformed capability' using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'idempotency key is required and must be 1-200 characters' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' or pg_column_size(p_args) > 16384 then
    raise exception 'arguments must be an object of at most 16 KB' using errcode = '22023';
  end if;
  if p_execution_mode not in ('mock', 'live') then
    raise exception 'execution mode must be mock or live' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 5 and 300 then
    raise exception 'lease must be 5-300 seconds' using errcode = '22023';
  end if;

  select rc.rc_status, rc.rc_tenant_id, rc.rc_agent_id into v_status, v_tenant, v_agent
  from gateway.resolve_credential(p_credential_secret) rc;
  if v_status <> 'ok' then
    return query select v_status, null::text, null::text, null::uuid, null::uuid, null::uuid, null::uuid, null::bigint,
      null::text, null::text, null::timestamptz, null::text, null::jsonb;
    return;
  end if;

  select ct.id, ct.task_id, ct.resource, ct.resource_constraints, ct.arguments_hash, ct.max_uses, ct.tool, ct.operation
    into v_cap, v_task, v_resource, v_constraints, v_args_hash_expected, v_max, v_tool, v_op
  from public.capability_tokens ct
  where ct.token_hash = p_token_hash and ct.tenant_id = v_tenant and ct.agent_id = v_agent;
  if v_cap is null then
    return query select 'ok'::text, 'rejected'::text, 'CAPABILITY_NOT_FOUND'::text, null::uuid, null::uuid, null::uuid, null::uuid,
      null::bigint, null::text, null::text, null::timestamptz, null::text, null::jsonb;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.capability:' || v_cap::text, 0));
  perform gateway.reconcile_capability(v_cap);

  select ct.uses, ct.reserved_uses, ct.expires_at, ct.status into v_uses, v_reserved, v_expires, v_cap_status
  from public.capability_tokens ct where ct.id = v_cap;

  v_args_hash := encode(extensions.digest(p_args::text, 'sha256'), 'hex');
  v_request_hash := encode(extensions.digest(
    coalesce(p_tool, '') || '|' || coalesce(p_operation, '') || '|' || coalesce(p_resource, '') || '|' || v_args_hash, 'sha256'), 'hex');

  -- Idempotent replay of an earlier reservation.
  select r.id, r.request_hash, r.status, r.lease_expires_at, r.reason_code into v_prev
  from public.capability_reservations r where r.capability_id = v_cap and r.idempotency_key = p_idempotency_key;
  if v_prev.id is not null then
    if v_prev.request_hash <> v_request_hash then
      return query select 'ok'::text, 'rejected'::text, 'IDEMPOTENCY_CONFLICT'::text, null::uuid, v_cap, v_task, v_agent,
        null::bigint, null::text, null::text, null::timestamptz, null::text, null::jsonb;
    elsif v_prev.status = 'reserved' then
      return query select 'ok'::text, 'in_progress'::text, 'EXECUTION_IN_PROGRESS'::text, v_prev.id, v_cap, v_task, v_agent,
        null::bigint, null::text, null::text, v_prev.lease_expires_at, null::text, null::jsonb;
    else
      return query
        select 'ok'::text, 'replayed'::text, v_prev.reason_code, v_prev.id, v_cap, v_task, v_agent, null::bigint, null::text, null::text,
               null::timestamptz, v_prev.status,
               (select jsonb_build_object('category', gr.result_category, 'githubRequestId', gr.github_request_id,
                  'resourceIds', gr.resource_ids, 'beforeSha', gr.before_sha, 'afterSha', gr.after_sha,
                  'httpStatusClass', gr.http_status_class, 'receiptId', gr.id)
                from public.github_execution_receipts gr where gr.execution_id = v_prev.id);
    end if;
    return;
  end if;
  -- Idempotent replay of an earlier rejection.
  if exists (select 1 from public.capability_consumptions cc
             where cc.capability_id = v_cap and cc.idempotency_key = p_idempotency_key and cc.request_hash = v_request_hash
               and cc.result = 'rejected' and not cc.simulated) then
    return query select 'ok'::text, 'rejected'::text,
      (select cc.reason_code from public.capability_consumptions cc
        where cc.capability_id = v_cap and cc.idempotency_key = p_idempotency_key limit 1),
      null::uuid, v_cap, v_task, v_agent, null::bigint, null::text, null::text, null::timestamptz, null::text, null::jsonb;
    return;
  end if;

  -- Ordered checks: first failing reason wins.
  if not gateway.is_connector_tool(v_tool) then
    v_reason := 'CONNECTOR_NOT_SUPPORTED';
  elsif v_cap_status = 'revoked' then
    v_reason := 'CAPABILITY_REVOKED';
  elsif v_uses >= v_max then
    v_reason := 'CAPABILITY_ALREADY_USED';
  elsif v_uses + v_reserved >= v_max then
    -- Transient, deliberately not recorded: the reservation may still be released.
    return query select 'ok'::text, 'rejected'::text, 'RESERVATION_IN_PROGRESS'::text, null::uuid, v_cap, v_task, v_agent,
      null::bigint, null::text, null::text, null::timestamptz, null::text, null::jsonb;
    return;
  elsif v_expires <= now() then
    v_reason := 'CAPABILITY_EXPIRED';
  elsif p_tool is distinct from v_tool or p_operation is distinct from v_op or p_resource is distinct from v_resource
        or v_args_hash is distinct from v_args_hash_expected or not gateway.constraints_satisfied(v_constraints, p_args) then
    v_reason := 'SCOPE_MISMATCH';
  end if;

  if v_reason is null then
    select b.repository_id, r.installation_row_id, gi.github_installation_id, r.owner || '/' || r.name, r.default_branch, gi.mode
      into v_repo_id, v_inst_row, v_gh_inst, v_full_name, v_default_branch, v_inst_mode
    from public.task_repository_bindings b
    join public.github_repositories r on r.id = b.repository_id and r.tenant_id = b.tenant_id
    join public.github_installations gi on gi.id = r.installation_row_id and gi.tenant_id = r.tenant_id
    where b.task_id = v_task and b.tenant_id = v_tenant;
    if v_repo_id is null then
      v_reason := 'REPOSITORY_NOT_BOUND';
    else
      v_reason := gateway.execution_blocker(v_cap, v_repo_id, v_inst_row);
      if v_reason is null and v_inst_mode is distinct from p_execution_mode then
        v_reason := 'EXECUTION_MODE_MISMATCH';
      end if;
    end if;
  end if;

  if v_reason is not null then
    if v_reason in ('CAPABILITY_ALREADY_USED', 'CAPABILITY_EXPIRED', 'CAPABILITY_REVOKED') then
      perform gateway.release_unused_budget(v_cap);
    end if;
    select count(*) into v_recent_rejects from public.capability_consumptions cc
      where cc.capability_id = v_cap and cc.result = 'rejected' and cc.created_at > now() - interval '60 seconds';
    if v_recent_rejects < 50 then
      insert into public.capability_consumptions (tenant_id, capability_id, agent_id, idempotency_key, request_hash, result, reason_code, simulated)
      values (v_tenant, v_cap, v_agent, p_idempotency_key, v_request_hash, 'rejected', v_reason, false);
    end if;
    return query select 'ok'::text, 'rejected'::text, v_reason, null::uuid, v_cap, v_task, v_agent, null::bigint, null::text, null::text,
      null::timestamptz, null::text, null::jsonb;
    return;
  end if;

  v_lease := now() + make_interval(secs => p_lease_seconds);
  insert into public.capability_reservations (
    tenant_id, capability_id, agent_id, task_id, idempotency_key, request_hash, tool, operation, execution_mode,
    installation_row_id, github_installation_id, repository_id, repository_full_name, lease_expires_at
  ) values (
    v_tenant, v_cap, v_agent, v_task, p_idempotency_key, v_request_hash, v_tool, v_op, p_execution_mode,
    v_inst_row, v_gh_inst, v_repo_id, v_full_name, v_lease
  ) returning id into v_exec;
  update public.capability_tokens set reserved_uses = reserved_uses + 1 where id = v_cap;

  insert into public.execution_events (tenant_id, task_id, tool_request_id, decision_id, event_type, result_status, summary,
    normalized_effect_metadata)
  select v_tenant, v_task, d.tool_request_id, d.id, 'tool_invoked', 'info',
         format('%s GitHub %s: capability use reserved (execution %s).', upper(p_execution_mode), v_tool, left(v_exec::text, 8)),
         jsonb_build_object('schemaVersion', 1, 'phase', 'reserved', 'mode', p_execution_mode, 'executionId', v_exec)
  from public.capability_tokens ct join public.authorization_decisions d on d.id = ct.authorization_decision_id
  where ct.id = v_cap;

  return query select 'ok'::text, 'reserved'::text, 'RESERVED'::text, v_exec, v_cap, v_task, v_agent, v_gh_inst, v_full_name,
    v_default_branch, v_lease, null::text, null::jsonb;
end;
$fn$;
revoke all on function gateway.reserve_execution(text, text, text, text, text, jsonb, text, text, integer) from public;
grant execute on function gateway.reserve_execution(text, text, text, text, text, jsonb, text, text, integer) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Phase 1.5: immediately before dispatch, re-check that nothing was revoked.
-- Sets dispatched_at exactly once; a second call can never dispatch again.
-- ---------------------------------------------------------------------------
create or replace function gateway.mark_dispatched(p_execution_id uuid, p_agent_id uuid)
returns table (md_status text, md_reason text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  r public.capability_reservations%rowtype;
  v_blocker text;
begin
  select * into r from public.capability_reservations where id = p_execution_id and agent_id = p_agent_id;
  if r.id is null then return query select 'not_found'::text, null::text; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('authority.capability:' || r.capability_id::text, 0));
  select * into r from public.capability_reservations where id = p_execution_id;
  if r.status <> 'reserved' then return query select 'not_reserved'::text, r.status; return; end if;
  if r.dispatched_at is not null then return query select 'already_dispatched'::text, null::text; return; end if;
  if r.lease_expires_at <= now() then
    perform gateway.reconcile_capability(r.capability_id);
    return query select 'lease_expired'::text, null::text; return;
  end if;
  v_blocker := gateway.execution_blocker(r.capability_id, r.repository_id, r.installation_row_id);
  if v_blocker is not null then
    perform gateway.settle_reservation(r.id, 'released', v_blocker, null, null, null, null, null, null, null);
    return query select 'blocked'::text, v_blocker; return;
  end if;
  update public.capability_reservations set dispatched_at = now() where id = r.id;
  insert into public.execution_events (tenant_id, task_id, tool_request_id, decision_id, event_type, result_status, summary,
    normalized_effect_metadata)
  select r.tenant_id, r.task_id, d.tool_request_id, d.id, 'tool_invoked', 'info',
         format('%s GitHub %s: request dispatched.', upper(r.execution_mode), r.tool),
         jsonb_build_object('schemaVersion', 1, 'phase', 'dispatched', 'mode', r.execution_mode, 'executionId', r.id)
  from public.capability_tokens ct join public.authorization_decisions d on d.id = ct.authorization_decision_id
  where ct.id = r.capability_id;
  return query select 'ok'::text, null::text;
end;
$fn$;
revoke all on function gateway.mark_dispatched(uuid, uuid) from public;
grant execute on function gateway.mark_dispatched(uuid, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Phase 2: settle. Only the reserving execution (its id AND agent) may settle
-- it, and only while it is still 'reserved'.
-- ---------------------------------------------------------------------------
create or replace function gateway.finish_execution(
  p_execution_id uuid,
  p_agent_id uuid,
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
returns table (f_status text, f_receipt_id uuid, f_final_status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  r public.capability_reservations%rowtype;
  v_receipt uuid;
begin
  select * into r from public.capability_reservations where id = p_execution_id and agent_id = p_agent_id;
  if r.id is null then return query select 'not_found'::text, null::uuid, null::text; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('authority.capability:' || r.capability_id::text, 0));
  select * into r from public.capability_reservations where id = p_execution_id;
  if r.status <> 'reserved' then
    return query select 'already_final'::text, (select gr.id from public.github_execution_receipts gr where gr.execution_id = r.id), r.status;
    return;
  end if;
  v_receipt := gateway.settle_reservation(
    p_execution_id, p_category, p_reason_code, p_github_request_id, p_http_status_class,
    p_resource_ids, p_before_sha, p_after_sha, p_started_at, p_redaction);
  return query select 'ok'::text, v_receipt,
    (select rr.status from public.capability_reservations rr where rr.id = p_execution_id);
end;
$fn$;
revoke all on function gateway.finish_execution(uuid, uuid, text, text, text, smallint, jsonb, text, text, timestamptz, jsonb) from public;
grant execute on function gateway.finish_execution(uuid, uuid, text, text, text, smallint, jsonb, text, text, timestamptz, jsonb) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Admin annotation of an indeterminate execution. The use stays spent (a
-- capability's uses only ever move forward); this records what an operator
-- found by inspecting GitHub.
-- ---------------------------------------------------------------------------
create or replace function gateway.github_resolve_indeterminate(
  p_tenant_id uuid, p_user_id uuid, p_execution_id uuid, p_outcome text, p_note text
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_resolved text;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'security_admin') then return 'forbidden'; end if;
  if p_outcome not in ('executed', 'not_executed') then raise exception 'outcome must be executed or not_executed' using errcode = '22023'; end if;
  select r.status, r.resolved_outcome into v_status, v_resolved
  from public.capability_reservations r where r.id = p_execution_id and r.tenant_id = p_tenant_id for update;
  if v_status is null then return 'not_found'; end if;
  if v_status <> 'indeterminate' then return 'not_indeterminate'; end if;
  if v_resolved is not null then return 'already_resolved'; end if;
  update public.capability_reservations
    set resolved_outcome = p_outcome, resolved_at = now(), resolved_by_principal_id = gateway.actor_principal(p_tenant_id, p_user_id),
        resolution_note = left(p_note, 500)
    where id = p_execution_id;
  return 'ok';
end;
$fn$;
revoke all on function gateway.github_resolve_indeterminate(uuid, uuid, uuid, text, text) from public;
grant execute on function gateway.github_resolve_indeterminate(uuid, uuid, uuid, text, text) to authority_gateway;
