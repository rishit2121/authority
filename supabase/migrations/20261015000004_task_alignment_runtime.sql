-- Task alignment, increment 2: checking each tool call at authorization time.
--
-- The model review runs in application code BETWEEN prepare_authorization and
-- commit (never inside a transaction). Its result is recorded here bound to
-- the call's exact arguments -- hashed in SQL from the same jsonb the commit
-- receives, so the binding cannot drift from what is authorized -- plus the
-- task's objectives version, context revision, active contract and
-- idempotency key. commit_authorization_aligned re-verifies all of that under
-- the task's lock and only then calls the unchanged commit_authorization.
-- A review can only stop a call; it never widens a contract, changes values,
-- restores budget or overrides a deterministic denial (it is never consulted
-- for one).

-- ---------------------------------------------------------------------------
-- 1. Which checks run (all on by default once alignment is on). Lets an
--    application run only the input check, the action check, or both, as in
--    the paper's ablation; also used by the evaluation harness.
-- ---------------------------------------------------------------------------
alter table public.alignment_settings
  add column check_plans boolean not null default true,
  add column check_content boolean not null default true,
  add column check_actions boolean not null default true;

alter table public.alignment_reviews add column consumed_at timestamptz;

drop function if exists gateway.alignment_context(text, uuid);
create function gateway.alignment_context(p_secret text, p_task_id uuid)
returns table (
  ac_status text, ac_credential_kind text, ac_tenant_id uuid, ac_application_id uuid,
  ac_mode text, ac_policy text, ac_max_content_bytes integer,
  ac_objective_version integer, ac_context_revision integer,
  ac_task_intent text, ac_objective_request text, ac_objective_extraction jsonb, ac_objective_status text,
  ac_contract_id uuid, ac_allowed_actions jsonb,
  ac_check_plans boolean, ac_check_content boolean, ac_check_actions boolean,
  ac_plan_outcome text, ac_plan_decision text
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid; v_kind text;
  v_mode text; v_policy text; v_max integer;
  v_plans boolean := true; v_content boolean := true; v_actions boolean := true;
  v_obj_version integer := 0; v_ctx integer := 0;
  v_intent text; v_req text; v_ext jsonb; v_obj_status text;
  v_contract uuid; v_actions_json jsonb; v_plan_outcome text; v_plan_decision text;
begin
  select aa_status, aa_tenant_id, aa_application_id, aa_credential_kind into v_status, v_tenant, v_app, v_kind
  from gateway.alignment_auth(p_secret, p_task_id);
  if v_status <> 'ok' then
    return query select v_status, null::text, null::uuid, null::uuid, null::text, null::text, null::integer,
      null::integer, null::integer, null::text, null::text, null::jsonb, null::text, null::uuid, null::jsonb,
      null::boolean, null::boolean, null::boolean, null::text, null::text;
    return;
  end if;

  if v_app is not null then
    select s.mode, s.policy, s.max_content_bytes, s.check_plans, s.check_content, s.check_actions
      into v_mode, v_policy, v_max, v_plans, v_content, v_actions
    from public.alignment_settings s where s.application_id = v_app;
  end if;
  v_mode := coalesce(v_mode, 'off'); v_policy := coalesce(v_policy, 'production'); v_max := coalesce(v_max, 32768);
  v_plans := coalesce(v_plans, true); v_content := coalesce(v_content, true); v_actions := coalesce(v_actions, true);

  select t.intent into v_intent from public.tasks t where t.id = p_task_id;
  select st.objective_version, st.context_revision into v_obj_version, v_ctx
  from public.task_alignment_state st where st.task_id = p_task_id;
  v_obj_version := coalesce(v_obj_version, 0); v_ctx := coalesce(v_ctx, 0);
  if v_obj_version > 0 then
    select o.request_text, o.extraction, o.status into v_req, v_ext, v_obj_status
    from public.task_objectives o where o.task_id = p_task_id and o.version = v_obj_version;
  end if;

  select tac.id, tac.allowed_actions into v_contract, v_actions_json
  from public.task_authority_contracts tac
  where tac.task_id = p_task_id and authz.contract_is_currently_active(tac.contract_status, tac.expires_at)
  limit 1;

  if v_contract is not null and v_obj_version > 0 then
    select r.outcome, r.decision into v_plan_outcome, v_plan_decision
    from public.alignment_reviews r
    where r.contract_id = v_contract and r.kind = 'plan' and r.objective_version = v_obj_version
    order by r.created_at desc limit 1;
  end if;

  return query select 'ok'::text, v_kind, v_tenant, v_app, v_mode, v_policy, v_max, v_obj_version, v_ctx,
    v_intent, v_req, v_ext, v_obj_status, v_contract, v_actions_json, v_plans, v_content, v_actions,
    v_plan_outcome, v_plan_decision;
end;
$fn$;
revoke all on function gateway.alignment_context(text, uuid) from public;
grant execute on function gateway.alignment_context(text, uuid) to authority_gateway;

-- With plan checks turned off, the activation gate does not wait for a plan review.
create or replace function gateway.contract_alignment_cleared(p_contract_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_task uuid; v_mode text; v_plans boolean; v_obj integer;
begin
  select tac.task_id, s.mode, s.check_plans into v_task, v_mode, v_plans
  from public.task_authority_contracts tac
  join public.tasks t on t.id = tac.task_id
  left join public.customers c on c.id = t.customer_id
  left join public.alignment_settings s on s.application_id = c.application_id
  where tac.id = p_contract_id;
  if coalesce(v_mode, 'off') <> 'enforce' or not coalesce(v_plans, true) then return true; end if;
  select objective_version into v_obj from public.task_alignment_state where task_id = v_task;
  return exists (
    select 1 from public.alignment_reviews r
    where r.contract_id = p_contract_id and r.kind = 'plan' and r.mode = 'enforce'
      and r.objective_version = coalesce(v_obj, 0)
      and (r.outcome = 'aligned' or r.decision = 'approved')
      and r.decision is distinct from 'rejected'
  );
end;
$fn$;
revoke all on function gateway.contract_alignment_cleared(uuid) from public;

create or replace function public.set_alignment_checks(
  p_application_id uuid, p_check_plans boolean, p_check_content boolean, p_check_actions boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_tenant uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'set_alignment_checks() requires an authenticated caller' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.applications where id = p_application_id;
  if v_tenant is null or not authz.is_member_of(v_tenant) then return 'not_found'; end if;
  if not authz.has_min_role(v_tenant, 'security_admin') then return 'forbidden'; end if;
  insert into public.alignment_settings (application_id, tenant_id, check_plans, check_content, check_actions, updated_by, updated_at)
  values (p_application_id, v_tenant, coalesce(p_check_plans, true), coalesce(p_check_content, true), coalesce(p_check_actions, true), (select auth.uid()), now())
  on conflict (application_id) do update
    set check_plans = excluded.check_plans, check_content = excluded.check_content, check_actions = excluded.check_actions,
        updated_by = excluded.updated_by, updated_at = now();
  return 'ok';
end;
$fn$;
revoke all on function public.set_alignment_checks(uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_alignment_checks(uuid, boolean, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The exact call a review is about, hashed in SQL from the authorized jsonb.
-- ---------------------------------------------------------------------------
create or replace function gateway.alignment_action_subject(p_tool text, p_operation text, p_resource text, p_args jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(
    coalesce(p_tool, '') || '|' || coalesce(p_operation, '') || '|' || coalesce(p_resource, '') || '|' || coalesce(p_args::text, ''),
    'sha256'), 'hex');
$$;
revoke all on function gateway.alignment_action_subject(text, text, text, jsonb) from public;

create or replace function gateway.record_action_review(
  p_secret text, p_task_id uuid, p_tool text, p_operation text, p_resource text, p_args jsonb,
  p_idempotency_key text, p_mode text, p_policy text, p_objective_version integer, p_context_revision integer,
  p_contract_id uuid, p_outcome text, p_findings jsonb, p_scores jsonb, p_feedback text, p_reviewer jsonb, p_usage jsonb
)
returns table (rar_status text, rar_review_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_obj integer; v_ctx integer; v_contract uuid; v_id uuid;
begin
  select aa_status, aa_tenant_id into v_status, v_tenant from gateway.alignment_auth(p_secret, p_task_id);
  if v_status <> 'ok' then return query select v_status, null::uuid; return; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) > 200 then
    return query select 'invalid_request'::text, null::uuid; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.alignment:' || p_task_id::text, 0));
  perform gateway.ensure_task_alignment_state(p_task_id, v_tenant);
  select objective_version, context_revision into v_obj, v_ctx from public.task_alignment_state where task_id = p_task_id;
  select tac.id into v_contract from public.task_authority_contracts tac
  where tac.task_id = p_task_id and authz.contract_is_currently_active(tac.contract_status, tac.expires_at) limit 1;
  if p_objective_version is distinct from v_obj or p_context_revision is distinct from v_ctx
     or p_contract_id is distinct from v_contract then
    return query select 'stale'::text, null::uuid; return;
  end if;

  insert into public.alignment_reviews (
    tenant_id, task_id, kind, mode, policy, subject_hash, objective_version, context_revision,
    contract_id, idempotency_key, outcome, findings, scores, feedback, reviewer, usage
  ) values (
    v_tenant, p_task_id, 'action', p_mode, p_policy,
    gateway.alignment_action_subject(p_tool, p_operation, p_resource, p_args),
    p_objective_version, p_context_revision, p_contract_id, p_idempotency_key, p_outcome,
    coalesce(p_findings, '[]'::jsonb), coalesce(p_scores, '[]'::jsonb), p_feedback,
    coalesce(p_reviewer, '{}'::jsonb), coalesce(p_usage, '{}'::jsonb)
  ) returning id into v_id;
  return query select 'ok'::text, v_id;
end;
$fn$;
revoke all on function gateway.record_action_review(text, uuid, text, text, text, jsonb, text, text, text, integer, integer, uuid, text, jsonb, jsonb, text, jsonb, jsonb) from public;
grant execute on function gateway.record_action_review(text, uuid, text, text, text, jsonb, text, text, text, integer, integer, uuid, text, jsonb, jsonb, text, jsonb, jsonb) to authority_gateway;

-- An earlier review of exactly this call (same arguments, same idempotency key, same versions):
-- a retry reuses it, and a person's approval of it is honored.
create or replace function gateway.find_action_review(
  p_secret text, p_task_id uuid, p_tool text, p_operation text, p_resource text, p_args jsonb,
  p_idempotency_key text, p_objective_version integer, p_context_revision integer
)
returns table (
  far_status text, far_review_id uuid, far_outcome text, far_decision text, far_findings jsonb,
  far_feedback text, far_policy text, far_mode text
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_status text;
begin
  select aa_status into v_status from gateway.alignment_auth(p_secret, p_task_id);
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::text, null::text, null::jsonb, null::text, null::text, null::text; return;
  end if;
  return query
    select 'ok'::text, r.id, r.outcome, r.decision, r.findings, r.feedback, r.policy, r.mode
    from public.alignment_reviews r
    where r.task_id = p_task_id and r.kind = 'action'
      and r.subject_hash = gateway.alignment_action_subject(p_tool, p_operation, p_resource, p_args)
      and r.idempotency_key = p_idempotency_key
      and r.objective_version = p_objective_version and r.context_revision = p_context_revision
    order by r.created_at desc limit 1;
end;
$fn$;
revoke all on function gateway.find_action_review(text, uuid, text, text, text, jsonb, text, integer, integer) from public;
grant execute on function gateway.find_action_review(text, uuid, text, text, text, jsonb, text, integer, integer) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 3. Commit, only after the review is confirmed current -- in one transaction.
-- ---------------------------------------------------------------------------
create or replace function gateway.commit_authorization_aligned(
  p_review_id uuid,
  p_credential_secret text, p_task_id uuid, p_tool text, p_operation text, p_resource text, p_args jsonb,
  p_argument_audit jsonb, p_plan_node_id uuid, p_idempotency_key text, p_registry_version text,
  p_compiler_version text, p_risk_class text, p_max_uses integer, p_token_hash text,
  p_sem_provider text, p_sem_model text, p_sem_model_version text, p_sem_state public.semantic_evidence_state,
  p_sem_signals jsonb, p_sem_indicators text[], p_sem_risk public.semantic_risk_level,
  p_sem_confidence double precision, p_sem_latency_ms integer, p_sem_input_hash text, p_sem_redaction jsonb,
  p_sem_error_category text, p_gateway_version text, p_registry_requires_approval boolean
)
returns table (
  r_status text, r_replayed boolean, r_decision_id uuid, r_final_decision_id uuid, r_tool_request_id uuid,
  r_det_outcome public.authorization_outcome, r_final_outcome public.authorization_outcome, r_reason_codes text[],
  r_contract_id uuid, r_contract_version integer, r_semantic_mode public.semantic_mode, r_semantic_policy text,
  r_degraded boolean, r_degraded_reason text, r_narrowed boolean, r_capability_id uuid,
  r_capability_expires_at timestamptz, r_capability_max_uses integer, r_remaining_invocations integer
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_review public.alignment_reviews; v_obj integer; v_ctx integer; v_contract uuid; v_auth text;
begin
  select aa_status into v_auth from gateway.alignment_auth(p_credential_secret, p_task_id);
  select * into v_review from public.alignment_reviews where id = p_review_id;

  -- Same lock order as record_*: alignment state first, then the runtime lock inside commit_authorization.
  perform pg_advisory_xact_lock(hashtextextended('authority.alignment:' || p_task_id::text, 0));
  select objective_version, context_revision into v_obj, v_ctx from public.task_alignment_state where task_id = p_task_id;
  select tac.id into v_contract from public.task_authority_contracts tac
  where tac.task_id = p_task_id and authz.contract_is_currently_active(tac.contract_status, tac.expires_at) limit 1;

  if v_auth is distinct from 'ok' or v_review.id is null or v_review.task_id <> p_task_id or v_review.kind <> 'action'
     or v_review.mode <> 'enforce'
     or v_review.subject_hash <> gateway.alignment_action_subject(p_tool, p_operation, p_resource, p_args)
     or v_review.idempotency_key is distinct from p_idempotency_key
     or v_review.objective_version is distinct from v_obj
     or v_review.context_revision is distinct from v_ctx
     or v_review.contract_id is distinct from v_contract
     or v_review.decision is not distinct from 'rejected'
     or not (v_review.outcome = 'aligned' or v_review.decision = 'approved') then
    return query select 'alignment_stale'::text, false, null::uuid, null::uuid, null::uuid,
      null::public.authorization_outcome, null::public.authorization_outcome, '{}'::text[], null::uuid, null::integer,
      'off'::public.semantic_mode, 'not_applicable'::text, false, null::text, false, null::uuid, null::timestamptz,
      null::integer, null::integer;
    return;
  end if;

  update public.alignment_reviews set consumed_at = coalesce(consumed_at, now()) where id = p_review_id;

  return query select * from gateway.commit_authorization(
    p_credential_secret, p_task_id, p_tool, p_operation, p_resource, p_args, p_argument_audit, p_plan_node_id,
    p_idempotency_key, p_registry_version, p_compiler_version, p_risk_class, p_max_uses, p_token_hash,
    p_sem_provider, p_sem_model, p_sem_model_version, p_sem_state, p_sem_signals, p_sem_indicators, p_sem_risk,
    p_sem_confidence, p_sem_latency_ms, p_sem_input_hash, p_sem_redaction, p_sem_error_category,
    p_gateway_version, p_registry_requires_approval
  );
end;
$fn$;
revoke all on function gateway.commit_authorization_aligned(
  uuid, text, uuid, text, text, text, jsonb, jsonb, uuid, text, text, text, text, integer, text,
  text, text, text, public.semantic_evidence_state, jsonb, text[], public.semantic_risk_level, double precision,
  integer, text, jsonb, text, text, boolean
) from public;
grant execute on function gateway.commit_authorization_aligned(
  uuid, text, uuid, text, text, text, jsonb, jsonb, uuid, text, text, text, text, integer, text,
  text, text, text, public.semantic_evidence_state, jsonb, text[], public.semantic_risk_level, double precision,
  integer, text, jsonb, text, text, boolean
) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261015000004'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
