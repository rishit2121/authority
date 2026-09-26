-- Part 7: per-task commit ceiling in reserve_execution, and install-flow helpers.

create or replace function gateway.github_reported_installation(p_tenant_id uuid, p_user_id uuid, p_nonce_hash text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select s.reported_installation_id from public.github_install_states s
  where s.nonce_hash = p_nonce_hash and s.tenant_id = p_tenant_id and s.user_id = p_user_id
    and s.expires_at > now() and s.status = 'installation_reported';
$$;
revoke all on function gateway.github_reported_installation(uuid, uuid, text) from public;
grant execute on function gateway.github_reported_installation(uuid, uuid, text) to authority_gateway;

create or replace function gateway.github_reject_install(p_tenant_id uuid, p_user_id uuid, p_nonce_hash text, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.github_install_states
    set status = 'rejected', reject_reason = case when p_reason ~ '^[A-Z_]{1,60}$' then p_reason else 'REJECTED' end
    where nonce_hash = p_nonce_hash and tenant_id = p_tenant_id and user_id = p_user_id and status in ('issued', 'installation_reported');
$$;
revoke all on function gateway.github_reject_install(uuid, uuid, text, text) from public;
grant execute on function gateway.github_reject_install(uuid, uuid, text, text) to authority_gateway;

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
  elsif v_tool = 'github.put_file' and (
      select count(*) from public.github_execution_receipts gr
      where gr.task_id = v_task and gr.tool = 'github.put_file' and gr.result_category = 'succeeded') >= 20 then
    -- Hard per-task commit ceiling, independent of any contract budget.
    v_reason := 'COMMIT_LIMIT_REACHED';
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
