-- Adds the one check only gateway.prepare_authorization needs beyond what
-- the redefined gateway.resolve_credential already gives every caller for
-- free (20261002000001_task_sessions.sql): when the presented credential is
-- a task session, prepare_authorization independently looks it up again (by
-- the same token hash) to confirm the caller's own `taskId` argument
-- matches the task the session was issued for, AND that the task's
-- currently active contract is still the exact one the session was bound
-- to at creation. Either check failing fails this call with a distinct
-- status rather than silently carrying a stale or mismatched session onto
-- different authority. commit_authorization, reserve_connector_execution,
-- reserve_execution, consume_capability, revoke_capability,
-- approval_for_request and approval_by_id need no equivalent change: a
-- session only ever stands in as the IDENTITY a runtime key already was to
-- them, never new authority, and (for the execute-side functions) the
-- capability itself already encodes and re-verifies the exact task, tool,
-- operation, resource and arguments it was authorized for.

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
  v_sess_task uuid;
  v_sess_contract uuid;
  v_cur_contract uuid;
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

  -- The credential resolved; if it was a task session (not a runtime key),
  -- re-verify it is still good for THIS exact task and still bound to the
  -- task's currently active contract. A runtime key has no such binding to
  -- check, so this whole block is skipped for one.
  if left(p_credential_secret, 13) = 'authority_ts_' then
    select ts.task_id, ts.contract_id into v_sess_task, v_sess_contract
    from public.task_sessions ts
    where ts.token_hash = encode(extensions.digest(p_credential_secret, 'sha256'), 'hex');

    if v_sess_task is distinct from p_task_id then
      return query select 'session_task_mismatch'::text, 'off'::public.semantic_mode, null::text, null::text,
        null::integer, false, false, null::integer, null::text, '{}'::text[], '[]'::jsonb,
        null::public.authorization_outcome, false;
      return;
    end if;
    select acft.acft_contract_id into v_cur_contract from gateway.active_contract_for_task(p_task_id) acft;
    if v_cur_contract is null or v_cur_contract <> v_sess_contract then
      return query select 'session_contract_stale'::text, 'off'::public.semantic_mode, null::text, null::text,
        null::integer, false, false, null::integer, null::text, '{}'::text[], '[]'::jsonb,
        null::public.authorization_outcome, false;
      return;
    end if;
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

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261002000002'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
