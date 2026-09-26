-- Part 6: capability consumption (simulated), revocation, enforcement
-- settings, and readiness. Every path that must record a rejection RETURNS a
-- status rather than raising, so the record survives.

create or replace function gateway.constraints_satisfied(p_constraints jsonb, p_args jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_constraint jsonb;
  v_arg jsonb;
  v_value text;
begin
  for v_constraint in select c.value from jsonb_array_elements(coalesce(p_constraints -> 'items', '[]'::jsonb)) c loop
    v_arg := p_args -> (v_constraint ->> 'key');
    if v_arg is null then return false; end if;
    if jsonb_typeof(v_arg) = 'array' then
      select string_agg(elem, ',') into v_value from jsonb_array_elements_text(v_arg) elem;
    else
      v_value := v_arg #>> '{}';
    end if;
    if v_constraint ? 'equals' and v_value is distinct from (v_constraint ->> 'equals') then return false; end if;
    if v_constraint ? 'matches' and not authz.glob_match(v_constraint ->> 'matches', v_value) then return false; end if;
  end loop;
  return true;
end;
$fn$;
revoke all on function gateway.constraints_satisfied(jsonb, jsonb) from public;
grant execute on function gateway.constraints_satisfied(jsonb, jsonb) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Simulated consumption. Validates everything a real executor would, and calls
-- nothing external. The presented token arrives already hashed: the database
-- never sees a capability's plaintext.
-- ---------------------------------------------------------------------------
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
  select ct.uses, ct.status into v_t_uses, v_t_status from public.capability_tokens ct where ct.id = v_cap_id;

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

  if v_t_status = 'revoked' then
    v_reason := 'CAPABILITY_REVOKED';
  elsif v_t_uses >= v_t_max then
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

-- ---------------------------------------------------------------------------
-- Revocation: by the owning agent (through the gateway) or by an admin.
-- ---------------------------------------------------------------------------
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
  insert into public.execution_events (tenant_id, task_id, capability_id, event_type, result_status, summary)
  values (v_tenant, v_task, v_budget, 'capability_revoked', 'info', 'Capability revoked by an administrator.');
end;
$fn$;
revoke all on function public.revoke_capability(uuid, text) from public, anon;
grant execute on function public.revoke_capability(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Enforcement settings. enforce needs (a) an admin, (b) an explicit approval
-- of this exact provider and model, and (c) a provider that is enforcement-
-- grade for the tenant's environment — the deterministic mock and lexical
-- baseline qualify only in a development tenant, never in staging/production.
-- ---------------------------------------------------------------------------
create or replace function public.set_semantic_settings_v2(
  p_tenant_id uuid,
  p_mode public.semantic_mode,
  p_provider text,
  p_model text,
  p_timeout_ms integer,
  p_required_classes text[],
  p_capability_ttl_seconds integer,
  p_approve_enforcement boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_principal uuid;
  v_previous jsonb;
  v_env public.tenant_environment;
  v_old_provider text;
  v_old_model text;
  v_old_approved_at timestamptz;
  v_approved_at timestamptz;
  v_approved_by uuid;
  v_approved_provider text;
  v_approved_model text;
begin
  if (select auth.uid()) is null then
    raise exception 'set_semantic_settings_v2() requires an authenticated caller' using errcode = '28000';
  end if;
  if p_tenant_id is null or not authz.has_min_role(p_tenant_id, 'security_admin') then
    raise exception 'insufficient privileges to change semantic settings' using errcode = '42501';
  end if;

  select p.id into v_principal from public.principals p where p.tenant_id = p_tenant_id and p.user_id = (select auth.uid());
  select te.environment into v_env from public.tenants te where te.id = p_tenant_id;

  select jsonb_build_object('mode', s.mode, 'provider', s.provider, 'model', s.model, 'timeoutMs', s.timeout_ms,
           'requiredClasses', s.semantic_required_classes, 'capabilityTtlSeconds', s.capability_ttl_seconds),
         s.provider, s.model, s.enforcement_approved_at
    into v_previous, v_old_provider, v_old_model, v_old_approved_at
  from public.semantic_settings s where s.tenant_id = p_tenant_id;

  select s.enforcement_approved_at, s.enforcement_approved_by_principal_id, s.enforcement_approved_provider, s.enforcement_approved_model
    into v_approved_at, v_approved_by, v_approved_provider, v_approved_model
  from public.semantic_settings s where s.tenant_id = p_tenant_id;

  -- A provider/model change voids any earlier approval.
  if v_approved_provider is distinct from p_provider or v_approved_model is distinct from p_model then
    v_approved_at := null; v_approved_by := null; v_approved_provider := null; v_approved_model := null;
  end if;

  if p_mode = 'enforce' then
    if not authz.has_min_role(p_tenant_id, 'admin') then
      raise exception 'only an admin or owner can enable enforcement' using errcode = '42501';
    end if;
    if not gateway.provider_enforcement_grade(p_provider, v_env) then
      raise exception 'provider "%" is not enforcement-grade for a % tenant', p_provider, v_env using errcode = '0A000';
    end if;
    if coalesce(p_approve_enforcement, false) then
      v_approved_at := now(); v_approved_by := v_principal; v_approved_provider := p_provider; v_approved_model := p_model;
    end if;
    if v_approved_at is null then
      raise exception 'enforcement requires explicit approval of this provider and model' using errcode = '0A000';
    end if;
  end if;

  insert into public.semantic_settings as s (
    tenant_id, mode, provider, model, timeout_ms, semantic_required_classes, capability_ttl_seconds,
    enforcement_approved_provider, enforcement_approved_model, enforcement_approved_at,
    enforcement_approved_by_principal_id, updated_at, updated_by_principal_id
  ) values (
    p_tenant_id, p_mode, p_provider, p_model, p_timeout_ms, coalesce(p_required_classes, '{}'::text[]), p_capability_ttl_seconds,
    v_approved_provider, v_approved_model, v_approved_at, v_approved_by, now(), v_principal
  )
  on conflict (tenant_id) do update
    set mode = excluded.mode, provider = excluded.provider, model = excluded.model, timeout_ms = excluded.timeout_ms,
        semantic_required_classes = excluded.semantic_required_classes,
        capability_ttl_seconds = excluded.capability_ttl_seconds,
        enforcement_approved_provider = excluded.enforcement_approved_provider,
        enforcement_approved_model = excluded.enforcement_approved_model,
        enforcement_approved_at = excluded.enforcement_approved_at,
        enforcement_approved_by_principal_id = excluded.enforcement_approved_by_principal_id,
        updated_at = now(), updated_by_principal_id = excluded.updated_by_principal_id;

  insert into public.semantic_settings_audit (tenant_id, actor_principal_id, previous_settings, new_settings)
  values (p_tenant_id, v_principal, v_previous,
    jsonb_build_object('mode', p_mode, 'provider', p_provider, 'model', p_model, 'timeoutMs', p_timeout_ms,
      'requiredClasses', coalesce(p_required_classes, '{}'::text[]), 'capabilityTtlSeconds', p_capability_ttl_seconds,
      'enforcementApproved', v_approved_at is not null));
end;
$fn$;
revoke all on function public.set_semantic_settings_v2(uuid, public.semantic_mode, text, text, integer, text[], integer, boolean)
  from public, anon;
grant execute on function public.set_semantic_settings_v2(uuid, public.semantic_mode, text, text, integer, text[], integer, boolean)
  to authenticated;

-- The Part 5 entry point becomes a thin wrapper: it can still set off/shadow,
-- and it can no longer be used to sidestep the enforcement approval.
create or replace function public.set_semantic_settings(
  p_tenant_id uuid,
  p_mode public.semantic_mode,
  p_provider text,
  p_model text,
  p_timeout_ms integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_classes text[] := '{}'::text[];
  v_ttl integer := 60;
begin
  select s.semantic_required_classes, s.capability_ttl_seconds into v_classes, v_ttl
  from public.semantic_settings s where s.tenant_id = p_tenant_id;
  perform public.set_semantic_settings_v2(p_tenant_id, p_mode, p_provider, p_model, p_timeout_ms,
    coalesce(v_classes, '{}'::text[]), coalesce(v_ttl, 60), false);
end;
$fn$;

-- Readiness probe for the gateway credential: proves login + function access, reveals nothing.
create or replace function gateway.ping()
returns boolean
language sql
security definer
set search_path = ''
as $$ select true; $$;
revoke all on function gateway.ping() from public;
grant execute on function gateway.ping() to authority_gateway;
