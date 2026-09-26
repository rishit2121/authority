-- Part 7: legacy simulated consumption stays available for non-connector tools
-- but (a) respects in-flight reservations, (b) refuses connector tools, which
-- must go through reserve -> dispatch -> settle, and (c) hands unused budget
-- back on expiry/revocation. Revocation paths release budget too.

create or replace function gateway.consume_capability(
  p_credential_secret text,
  p_token_hash text,
  p_tool text,
  p_operation text,
  p_resource text,
  p_args jsonb,
  p_idempotency_key text
)
returns table (
  cs_status text,
  cs_result text,
  cs_reason_code text,
  cs_capability_id uuid,
  cs_remaining_uses integer,
  cs_expires_at timestamptz,
  cs_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_tenant uuid;
  v_agent uuid;
  v_cap_id uuid;
  v_t_task uuid;
  v_t_cred uuid;
  v_t_contract uuid;
  v_t_version integer;
  v_t_tool text;
  v_t_op text;
  v_t_resource text;
  v_t_constraints jsonb;
  v_t_args_hash text;
  v_t_max integer;
  v_t_uses integer;
  v_t_reserved integer;
  v_t_expires timestamptz;
  v_t_status text;
  v_args_hash text;
  v_request_hash text;
  v_prev_hash text;
  v_prev_result text;
  v_prev_reason text;
  v_prev_use integer;
  v_c_status public.contract_status;
  v_c_expires timestamptz;
  v_c_version integer;
  v_task_status public.task_status;
  v_agent_status public.agent_status;
  v_cred_status public.agent_credential_status;
  v_reason text := null;
  v_revoke_reason text := null;
  v_recent_rejects integer;
  v_use integer;
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

  select rc.rc_status, rc.rc_tenant_id, rc.rc_agent_id into v_status, v_tenant, v_agent
  from gateway.resolve_credential(p_credential_secret) rc;
  if v_status <> 'ok' then
    return query select v_status, null::text, null::text, null::uuid, null::integer, null::timestamptz, false;
    return;
  end if;

  -- Same answer for "no such token", "another tenant's" and "another agent's".
  select ct.id, ct.task_id, ct.credential_id, ct.contract_id, ct.contract_version, ct.tool, ct.operation, ct.resource,
         ct.resource_constraints, ct.arguments_hash, ct.max_uses, ct.uses, ct.expires_at, ct.status
    into v_cap_id, v_t_task, v_t_cred, v_t_contract, v_t_version, v_t_tool, v_t_op, v_t_resource,
         v_t_constraints, v_t_args_hash, v_t_max, v_t_uses, v_t_expires, v_t_status
  from public.capability_tokens ct
  where ct.token_hash = p_token_hash and ct.tenant_id = v_tenant and ct.agent_id = v_agent;

  if v_cap_id is null then
    return query select 'ok'::text, 'rejected'::text, 'CAPABILITY_NOT_FOUND'::text, null::uuid, null::integer, null::timestamptz, false;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.capability:' || v_cap_id::text, 0));

  -- Re-read under the lock: a concurrent consumer may have used the last use.
  select ct.uses, ct.status, ct.reserved_uses into v_t_uses, v_t_status, v_t_reserved from public.capability_tokens ct where ct.id = v_cap_id;

  v_args_hash := encode(extensions.digest(p_args::text, 'sha256'), 'hex');
  v_request_hash := encode(extensions.digest(
    coalesce(p_tool, '') || '|' || coalesce(p_operation, '') || '|' || coalesce(p_resource, '') || '|' || v_args_hash,
    'sha256'), 'hex');

  select cc.request_hash, cc.result, cc.reason_code, cc.use_number
    into v_prev_hash, v_prev_result, v_prev_reason, v_prev_use
  from public.capability_consumptions cc where cc.capability_id = v_cap_id and cc.idempotency_key = p_idempotency_key;

  if v_prev_hash is not null then
    if v_prev_hash <> v_request_hash then
      return query select 'ok'::text, 'rejected'::text, 'IDEMPOTENCY_CONFLICT'::text, v_cap_id, null::integer, v_t_expires, false;
    else
      return query select 'ok'::text, v_prev_result, v_prev_reason, v_cap_id, v_t_max - v_t_uses, v_t_expires, true;
    end if;
    return;
  end if;

  select c.contract_status, c.expires_at, c.version into v_c_status, v_c_expires, v_c_version
  from public.task_authority_contracts c where c.id = v_t_contract and c.tenant_id = v_tenant;
  select t.status into v_task_status from public.tasks t where t.id = v_t_task and t.tenant_id = v_tenant;
  select ag.status into v_agent_status from public.agents ag where ag.id = v_agent and ag.tenant_id = v_tenant;
  select ac.status into v_cred_status from public.agent_credentials ac where ac.id = v_t_cred and ac.tenant_id = v_tenant;

  if gateway.is_connector_tool(v_t_tool) then
    -- Real tools execute only through the two-phase connector path; a simulated
    -- consume must never spend a capability that a connector could still use.
    v_reason := 'CONNECTOR_EXECUTION_REQUIRED';
  elsif v_t_status = 'revoked' then
    v_reason := 'CAPABILITY_REVOKED';
  elsif v_t_uses + v_t_reserved >= v_t_max then
    v_reason := 'CAPABILITY_ALREADY_USED';
  elsif v_t_expires <= now() then
    v_reason := 'CAPABILITY_EXPIRED';
  elsif v_c_status is null or not authz.contract_is_currently_active(v_c_status, v_c_expires) or v_c_version <> v_t_version then
    v_reason := 'CONTRACT_NO_LONGER_ACTIVE';
    v_revoke_reason := 'contract no longer active';
  elsif v_task_status is null or v_task_status not in ('contract_issued', 'executing') then
    v_reason := 'TASK_NO_LONGER_EXECUTABLE';
    v_revoke_reason := 'task no longer executable';
  elsif v_agent_status is distinct from 'active'::public.agent_status
        or v_cred_status is distinct from 'active'::public.agent_credential_status then
    v_reason := 'AGENT_OR_KEY_REVOKED';
    v_revoke_reason := 'agent or issuing key revoked';
  elsif p_tool is distinct from v_t_tool or p_operation is distinct from v_t_op
        or p_resource is distinct from v_t_resource or v_args_hash is distinct from v_t_args_hash
        or not gateway.constraints_satisfied(v_t_constraints, p_args) then
    v_reason := 'SCOPE_MISMATCH';
  end if;

  if v_reason is not null then
    if v_revoke_reason is not null and v_t_status = 'active' then
      update public.capability_tokens
        set status = 'revoked', revoked_at = now(), revoked_by = 'system', revocation_reason = v_revoke_reason
        where id = v_cap_id;
    end if;
    if v_reason in ('CAPABILITY_ALREADY_USED', 'CAPABILITY_EXPIRED') or v_revoke_reason is not null then
      perform gateway.release_unused_budget(v_cap_id);
    end if;
    -- Bound the audit volume an attacker can generate by hammering one token.
    select count(*) into v_recent_rejects from public.capability_consumptions cc
      where cc.capability_id = v_cap_id and cc.result = 'rejected' and cc.created_at > now() - interval '60 seconds';
    if v_recent_rejects < 50 then
      insert into public.capability_consumptions (tenant_id, capability_id, agent_id, idempotency_key, request_hash, result, reason_code)
      values (v_tenant, v_cap_id, v_agent, p_idempotency_key, v_request_hash, 'rejected', v_reason);
    end if;
    return query select 'ok'::text, 'rejected'::text, v_reason, v_cap_id, greatest(v_t_max - v_t_uses, 0), v_t_expires, false;
    return;
  end if;

  v_use := v_t_uses + 1;
  update public.capability_tokens
    set uses = v_use, status = case when v_use >= v_t_max then 'consumed' else 'active' end
    where id = v_cap_id;

  insert into public.capability_consumptions (tenant_id, capability_id, agent_id, idempotency_key, request_hash, result, reason_code, use_number)
  values (v_tenant, v_cap_id, v_agent, p_idempotency_key, v_request_hash, 'accepted', 'ACCEPTED', v_use);

  insert into public.execution_events (tenant_id, task_id, tool_request_id, event_type, result_status, summary)
  select v_tenant, v_t_task, d.tool_request_id, 'tool_invoked', 'info',
         format('SIMULATED: capability use %s of %s accepted for %s — no external tool was executed.', v_use, v_t_max, v_t_tool)
  from public.capability_tokens ct join public.authorization_decisions d on d.id = ct.authorization_decision_id
  where ct.id = v_cap_id;

  return query select 'ok'::text, 'accepted'::text, 'ACCEPTED'::text, v_cap_id, v_t_max - v_use, v_t_expires, false;
end;
$fn$;
revoke all on function gateway.consume_capability(text, text, text, text, text, jsonb, text) from public;
grant execute on function gateway.consume_capability(text, text, text, text, text, jsonb, text) to authority_gateway;

create or replace function gateway.revoke_capability(
  p_credential_secret text,
  p_capability_id uuid,
  p_reason text
)
returns table (rv_status text, rv_result text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_tenant uuid;
  v_agent uuid;
  v_cap_status text;
  v_task uuid;
  v_budget uuid;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'a revocation reason of 1-500 characters is required' using errcode = '22023';
  end if;

  select rc.rc_status, rc.rc_tenant_id, rc.rc_agent_id into v_status, v_tenant, v_agent
  from gateway.resolve_credential(p_credential_secret) rc;
  if v_status <> 'ok' then
    return query select v_status, null::text;
    return;
  end if;

  select ct.status, ct.task_id, ct.budget_capability_id into v_cap_status, v_task, v_budget
  from public.capability_tokens ct where ct.id = p_capability_id and ct.tenant_id = v_tenant and ct.agent_id = v_agent;

  if v_cap_status is null then
    return query select 'ok'::text, 'not_found'::text;
  elsif v_cap_status = 'revoked' then
    return query select 'ok'::text, 'already_revoked'::text;
  elsif v_cap_status = 'consumed' then
    return query select 'ok'::text, 'not_revocable'::text;
  else
    update public.capability_tokens
      set status = 'revoked', revoked_at = now(), revoked_by = 'agent', revocation_reason = btrim(p_reason)
      where id = p_capability_id;
    perform gateway.release_unused_budget(p_capability_id);
    insert into public.execution_events (tenant_id, task_id, capability_id, event_type, result_status, summary)
    values (v_tenant, v_task, v_budget, 'capability_revoked', 'info', 'Capability revoked by its agent.');
    return query select 'ok'::text, 'revoked'::text;
  end if;
end;
$fn$;
revoke all on function gateway.revoke_capability(text, uuid, text) from public;
grant execute on function gateway.revoke_capability(text, uuid, text) to authority_gateway;

create or replace function public.revoke_capability(p_capability_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant uuid;
  v_status text;
  v_task uuid;
  v_budget uuid;
  v_principal uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'revoke_capability() requires an authenticated caller' using errcode = '28000';
  end if;
  select ct.tenant_id, ct.status, ct.task_id, ct.budget_capability_id into v_tenant, v_status, v_task, v_budget
  from public.capability_tokens ct where ct.id = p_capability_id;
  if v_tenant is null then
    raise exception 'capability not found' using errcode = 'P0002';
  end if;
  if not authz.has_min_role(v_tenant, 'security_admin') then
    raise exception 'insufficient privileges to revoke this capability' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'a revocation reason of 1-500 characters is required' using errcode = '22023';
  end if;
  if v_status <> 'active' then
    return;
  end if;
  select p.id into v_principal from public.principals p where p.tenant_id = v_tenant and p.user_id = (select auth.uid());
  update public.capability_tokens
    set status = 'revoked', revoked_at = now(), revoked_by = 'admin', revoked_by_principal_id = v_principal,
        revocation_reason = btrim(p_reason)
    where id = p_capability_id;
  perform gateway.release_unused_budget(p_capability_id);
  insert into public.execution_events (tenant_id, task_id, capability_id, event_type, result_status, summary)
  values (v_tenant, v_task, v_budget, 'capability_revoked', 'info', 'Capability revoked by an administrator.');
end;
$fn$;
revoke all on function public.revoke_capability(uuid, text) from public, anon;
grant execute on function public.revoke_capability(uuid, text) to authenticated;
