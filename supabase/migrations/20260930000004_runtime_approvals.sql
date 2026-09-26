-- Part 7: runtime approval -> capability flow.
--
-- A `require_approval` final decision (semantic high risk, a tenant policy
-- class, or a registry requirement) now persists an approval request bound to
-- the EXACT runtime request: task, contract version, tool, resource, arguments
-- hash and the evidence that produced it. Humans decide it in the UI; the
-- agent then re-calls /authorize with the same idempotency key and the
-- capability is minted only after every input is re-checked against current
-- state. An approval can never widen what the deterministic layer allows.

alter table public.semantic_settings
  add column runtime_approval_classes text[] not null default '{}'::text[]
    check (runtime_approval_classes <@ array['low', 'medium', 'high']::text[]);

-- Policy/registry approval requirements are a legitimate narrowing even when
-- the semantic layer is off or in shadow; semantic evidence itself still cannot
-- narrow in those modes.
alter table public.final_decisions drop constraint final_shadow_is_never_narrowed;
alter table public.final_decisions drop constraint final_off_is_never_narrowed;
alter table public.final_decisions add constraint final_narrowing_needs_enforce_or_approval_policy
  check (semantic_mode = 'enforce' or not narrowed
         or composition_reasons && array['POLICY_REQUIRES_APPROVAL', 'REGISTRY_REQUIRES_APPROVAL']::text[]);

create table public.runtime_approval_requests (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  task_id     uuid not null,
  agent_id    uuid not null,
  tool_request_id uuid not null unique,
  authorization_decision_id uuid not null,
  final_decision_id uuid not null,
  contract_id uuid not null,
  contract_version integer not null check (contract_version > 0),
  tool        text not null check (tool ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  operation   text not null,
  resource    text check (resource is null or char_length(resource) <= 200),
  arguments_hash text not null check (arguments_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  risk_class  text not null check (risk_class in ('low', 'medium', 'high')),
  trigger_kind text not null check (trigger_kind in ('semantic_high_risk', 'policy_class', 'registry_requires_approval')),
  -- Codes and semantic summary only; never arguments.
  evidence    jsonb not null check (authz.has_allowed_schema_version(evidence, array[1]) and pg_column_size(evidence) <= 4096),
  context_hash text not null check (context_hash ~ '^[0-9a-f]{64}$'),
  required_approvals integer not null check (required_approvals between 1 and 2),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired', 'stale', 'consumed')),
  stale_reason text check (stale_reason is null or stale_reason ~ '^[A-Z_]{1,60}$'),
  minted_capability_id uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  resolved_at timestamptz,
  unique (id, tenant_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (agent_id, tenant_id) references public.agents (id, tenant_id),
  foreign key (tool_request_id, tenant_id) references public.tool_requests (id, tenant_id),
  foreign key (authorization_decision_id, tenant_id) references public.authorization_decisions (id, tenant_id),
  foreign key (final_decision_id, tenant_id) references public.final_decisions (id, tenant_id),
  foreign key (contract_id, tenant_id) references public.task_authority_contracts (id, tenant_id),
  constraint runtime_approval_expiry_after_creation check (expires_at > created_at and expires_at - created_at <= interval '24 hours'),
  constraint runtime_approval_minted_iff_consumed check ((status = 'consumed') = (minted_capability_id is not null))
);
create index runtime_approval_requests_tenant_idx on public.runtime_approval_requests (tenant_id, status, created_at desc);
create index runtime_approval_requests_task_idx on public.runtime_approval_requests (task_id, created_at);

create table public.runtime_approval_decisions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  request_id  uuid not null,
  approver_principal_id uuid not null,
  decision    text not null check (decision in ('approve', 'reject')),
  note        text check (note is null or char_length(note) <= 1000),
  created_at  timestamptz not null default now(),
  -- One vote per approver: two required approvals can never be one person voting twice.
  unique (request_id, approver_principal_id),
  unique (id, tenant_id),
  foreign key (request_id, tenant_id) references public.runtime_approval_requests (id, tenant_id),
  foreign key (approver_principal_id, tenant_id) references public.principals (id, tenant_id)
);
create trigger runtime_approval_decisions_append_only
  before update or delete on public.runtime_approval_decisions
  for each row execute function authz.forbid_update_delete();

-- Requests move forward only: pending -> {approved, rejected, expired, stale}, approved -> {consumed, stale, expired}.
create or replace function gateway.enforce_approval_request_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('authority.allow_demo_purge', true) = 'on' then return old; end if;
    raise exception 'runtime approval requests cannot be deleted' using errcode = '23514';
  end if;
  if (new.id, new.tenant_id, new.task_id, new.agent_id, new.tool_request_id, new.authorization_decision_id,
      new.final_decision_id, new.contract_id, new.contract_version, new.tool, new.operation, new.resource,
      new.arguments_hash, new.request_hash, new.risk_class, new.trigger_kind, new.evidence, new.context_hash,
      new.required_approvals, new.created_at, new.expires_at)
     is distinct from
     (old.id, old.tenant_id, old.task_id, old.agent_id, old.tool_request_id, old.authorization_decision_id,
      old.final_decision_id, old.contract_id, old.contract_version, old.tool, old.operation, old.resource,
      old.arguments_hash, old.request_hash, old.risk_class, old.trigger_kind, old.evidence, old.context_hash,
      old.required_approvals, old.created_at, old.expires_at) then
    raise exception 'an approval request''s binding is immutable' using errcode = '23514';
  end if;
  if old.status <> new.status and not (
       (old.status = 'pending' and new.status in ('approved', 'rejected', 'expired', 'stale'))
    or (old.status = 'approved' and new.status in ('consumed', 'stale', 'expired'))) then
    raise exception 'approval request cannot move from % to %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function gateway.enforce_approval_request_transition() from public;
create trigger runtime_approval_requests_guard
  before update or delete on public.runtime_approval_requests
  for each row execute function gateway.enforce_approval_request_transition();

alter table public.capability_tokens add column approval_request_id uuid;
alter table public.capability_tokens add constraint capability_tokens_approval_fk
  foreign key (approval_request_id, tenant_id) references public.runtime_approval_requests (id, tenant_id);
alter table public.runtime_approval_requests add constraint runtime_approval_minted_fk
  foreign key (minted_capability_id, tenant_id) references public.capability_tokens (id, tenant_id) deferrable initially deferred;

alter table public.runtime_approval_requests enable row level security;
alter table public.runtime_approval_decisions enable row level security;
revoke all on public.runtime_approval_requests, public.runtime_approval_decisions from public, anon, authenticated;
grant select on public.runtime_approval_requests, public.runtime_approval_decisions to authenticated;
create policy "runtime_approval_requests_select_within_tenant" on public.runtime_approval_requests
  for select to authenticated using (authz.is_member_of(tenant_id));
create policy "runtime_approval_decisions_select_within_tenant" on public.runtime_approval_decisions
  for select to authenticated using (authz.is_member_of(tenant_id));

-- Every input an approval depends on, hashed, EXCLUDING the arguments (the
-- approver never sees them; the arguments hash is bound separately).
create or replace function gateway.approval_context_hash(p_tenant_id uuid, p_task_id uuid, p_tool text, p_resource text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_parts text := '';
  v_contract record;
  v_sem record;
  v_agent public.agent_status;
  v_task public.task_status;
  v_inst record;
begin
  select c.id, c.version, c.contract_status, c.expires_at into v_contract
  from public.task_authority_contracts c
  where c.task_id = p_task_id and c.tenant_id = p_tenant_id and c.contract_status = 'active'
  order by c.version desc limit 1;
  v_parts := v_parts || coalesce(v_contract.id::text, '-') || '|' || coalesce(v_contract.version::text, '-') || '|'
             || coalesce(v_contract.expires_at::text, '-') || '|';

  select t.status, ag.status into v_task, v_agent
  from public.tasks t join public.agents ag on ag.id = t.agent_id and ag.tenant_id = t.tenant_id
  where t.id = p_task_id and t.tenant_id = p_tenant_id;
  v_parts := v_parts || coalesce(v_task::text, '-') || '|' || coalesce(v_agent::text, '-') || '|';

  select ss.mode, ss.provider, ss.model, ss.semantic_required_classes, ss.runtime_approval_classes into v_sem
  from public.semantic_settings ss where ss.tenant_id = p_tenant_id;
  v_parts := v_parts || coalesce(v_sem.mode::text, 'off') || '|' || coalesce(v_sem.provider, '') || '|' || coalesce(v_sem.model, '') || '|'
             || coalesce(array_to_string(v_sem.semantic_required_classes, ','), '') || '|'
             || coalesce(array_to_string(v_sem.runtime_approval_classes, ','), '') || '|';

  if gateway.is_connector_tool(p_tool) then
    select gi.status, gi.granted_permissions::text as perms, r.allowed, r.present, r.archived, r.id as repo_id into v_inst
    from public.task_repository_bindings b
    join public.github_repositories r on r.id = b.repository_id and r.tenant_id = b.tenant_id
    join public.github_installations gi on gi.id = r.installation_row_id and gi.tenant_id = r.tenant_id
    where b.task_id = p_task_id and b.tenant_id = p_tenant_id;
    v_parts := v_parts || coalesce(v_inst.status, '-') || '|' || coalesce(v_inst.perms, '-') || '|' || coalesce(v_inst.allowed::text, '-')
               || '|' || coalesce(v_inst.present::text, '-') || '|' || coalesce(v_inst.repo_id::text, '-') || '|';
  end if;
  return encode(extensions.digest(coalesce(p_tool, '') || '|' || coalesce(p_resource, '') || '|' || v_parts, 'sha256'), 'hex');
end;
$fn$;
revoke all on function gateway.approval_context_hash(uuid, uuid, text, text) from public;
grant execute on function gateway.approval_context_hash(uuid, uuid, text, text) to authority_gateway;

-- Mint. Re-checks the current contract/task/agent/key/policy/integration state
-- and the deterministic decision with the agent's re-supplied arguments.
create or replace function gateway.mint_approved_capability(
  p_tenant_id uuid, p_agent_id uuid, p_credential_id uuid, p_task_id uuid, p_tool_request_id uuid,
  p_tool text, p_resource text, p_args jsonb, p_registry_version text, p_compiler_version text,
  p_max_uses integer, p_token_hash text
)
returns table (m_status text, m_capability_id uuid, m_expires_at timestamptz, m_max_uses integer, m_remaining integer, m_reason text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  ar public.runtime_approval_requests%rowtype;
  v_ed record;
  v_reason text;
  v_ttl integer := 60;
  v_budget uuid;
  v_token uuid;
  v_expires timestamptz;
  v_remaining integer;
  v_agent_status public.agent_status;
  v_cred_status public.agent_credential_status;
  v_permits boolean;
begin
  select * into ar from public.runtime_approval_requests where tool_request_id = p_tool_request_id and tenant_id = p_tenant_id;
  if ar.id is null then return query select 'none'::text, null::uuid, null::timestamptz, null::integer, null::integer, null::text; return; end if;

  if ar.status = 'pending' and ar.expires_at <= now() then
    update public.runtime_approval_requests set status = 'expired', resolved_at = now() where id = ar.id;
    return query select 'expired'::text, null::uuid, null::timestamptz, null::integer, null::integer, 'APPROVAL_EXPIRED'::text; return;
  end if;
  if ar.status <> 'approved' then
    return query select ar.status, null::uuid, null::timestamptz, null::integer, null::integer, ar.stale_reason; return;
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'a capability token hash is required to mint' using errcode = '22023';
  end if;

  if ar.expires_at <= now() then
    update public.runtime_approval_requests set status = 'expired', resolved_at = now() where id = ar.id;
    return query select 'expired'::text, null::uuid, null::timestamptz, null::integer, null::integer, 'APPROVAL_EXPIRED'::text; return;
  end if;

  select ed.ed_outcome, ed.ed_contract_id, ed.ed_contract_version, ed.ed_contract_expires_at, ed.ed_action,
         ed.ed_budget_capability_id, ed.ed_max_per_action, ed.ed_reservable into v_ed
  from gateway.evaluate_deterministic(p_tenant_id, p_task_id, p_tool, p_args, p_registry_version, p_compiler_version, p_max_uses) ed;

  select ag.status into v_agent_status from public.agents ag where ag.id = p_agent_id and ag.tenant_id = p_tenant_id;
  select ac.status into v_cred_status from public.agent_credentials ac where ac.id = p_credential_id and ac.tenant_id = p_tenant_id;

  if v_ed.ed_outcome not in ('allow', 'allow_constrained') then
    v_reason := 'DETERMINISTIC_NO_LONGER_ALLOWS';
  elsif v_ed.ed_contract_id is distinct from ar.contract_id or v_ed.ed_contract_version is distinct from ar.contract_version then
    v_reason := 'CONTRACT_CHANGED';
  elsif v_agent_status is distinct from 'active'::public.agent_status
        or v_cred_status is distinct from 'active'::public.agent_credential_status then
    v_reason := 'AGENT_OR_KEY_REVOKED';
  elsif gateway.approval_context_hash(p_tenant_id, p_task_id, p_tool, p_resource) <> ar.context_hash then
    v_reason := 'CONTEXT_CHANGED';
  elsif not coalesce(v_ed.ed_reservable, false) then
    v_reason := 'NOT_RESERVABLE';
  end if;

  if v_reason is not null then
    update public.runtime_approval_requests set status = 'stale', stale_reason = v_reason, resolved_at = now() where id = ar.id;
    insert into public.execution_events (tenant_id, task_id, tool_request_id, decision_id, event_type, result_status, summary,
      normalized_effect_metadata)
    values (p_tenant_id, p_task_id, ar.tool_request_id, ar.authorization_decision_id, 'approval_resolved', 'blocked',
      format('Approval for %s is stale (%s); no capability was minted.', p_tool, v_reason),
      jsonb_build_object('schemaVersion', 1, 'phase', 'approval_stale', 'reason', v_reason));
    return query select 'stale'::text, null::uuid, null::timestamptz, null::integer, null::integer, v_reason; return;
  end if;

  select ss.capability_ttl_seconds into v_ttl from public.semantic_settings ss where ss.tenant_id = p_tenant_id;
  v_ttl := coalesce(v_ttl, 60);
  v_budget := v_ed.ed_budget_capability_id;
  if v_budget is null then
    insert into public.capabilities (
      tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
      status, max_invocations, consumed_uses, expires_at, contract_id
    ) values (
      p_tenant_id, p_task_id, ar.authorization_decision_id, p_agent_id, p_tool,
      jsonb_build_object('schemaVersion', 1, 'items', coalesce(v_ed.ed_action -> 'constraints', '[]'::jsonb)),
      'active', v_ed.ed_max_per_action, p_max_uses, v_ed.ed_contract_expires_at, ar.contract_id
    ) returning id into v_budget;
  else
    update public.capabilities set consumed_uses = consumed_uses + p_max_uses where id = v_budget;
  end if;

  v_expires := least(now() + make_interval(secs => v_ttl), v_ed.ed_contract_expires_at);
  insert into public.capability_tokens (
    tenant_id, agent_id, task_id, credential_id, contract_id, contract_version, authorization_decision_id,
    final_decision_id, budget_capability_id, tool, operation, resource, resource_constraints, arguments_hash,
    max_uses, expires_at, token_hash, approval_request_id
  ) values (
    p_tenant_id, p_agent_id, p_task_id, p_credential_id, ar.contract_id, ar.contract_version, ar.authorization_decision_id,
    ar.final_decision_id, v_budget, ar.tool, ar.operation, ar.resource,
    jsonb_build_object('schemaVersion', 1, 'items', coalesce(v_ed.ed_action -> 'constraints', '[]'::jsonb)),
    ar.arguments_hash, p_max_uses, v_expires, p_token_hash, ar.id
  ) returning id into v_token;

  update public.runtime_approval_requests set status = 'consumed', minted_capability_id = v_token, resolved_at = coalesce(resolved_at, now())
    where id = ar.id;
  insert into public.execution_events (tenant_id, task_id, capability_id, tool_request_id, decision_id, event_type, result_status, summary,
    normalized_effect_metadata)
  values (p_tenant_id, p_task_id, v_budget, ar.tool_request_id, ar.authorization_decision_id, 'capability_issued', 'success',
    format('Capability issued for %s after approval.', p_tool),
    jsonb_build_object('schemaVersion', 1, 'phase', 'capability_issued_after_approval'));
  select cap.max_invocations - cap.consumed_uses into v_remaining from public.capabilities cap where cap.id = v_budget;
  return query select 'minted'::text, v_token, v_expires, p_max_uses, v_remaining, null::text;
end;
$fn$;
revoke all on function gateway.mint_approved_capability(uuid, uuid, uuid, uuid, uuid, text, text, jsonb, text, text, integer, text) from public;
grant execute on function gateway.mint_approved_capability(uuid, uuid, uuid, uuid, uuid, text, text, jsonb, text, text, integer, text) to authority_gateway;

-- Status lookups for the agent's polling, authenticated by its runtime key.
create or replace function gateway.approval_for_request(p_credential_secret text, p_tool_request_id uuid)
returns table (a_status text, a_approval_id uuid, a_state text, a_required integer, a_approved integer, a_expires_at timestamptz, a_reason text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_agent uuid;
begin
  select rc.rc_status, rc.rc_tenant_id, rc.rc_agent_id into v_status, v_tenant, v_agent
  from gateway.resolve_credential(p_credential_secret) rc;
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::text, null::integer, null::integer, null::timestamptz, null::text; return;
  end if;
  return query
    select 'ok'::text, ar.id,
           case when ar.status = 'pending' and ar.expires_at <= now() then 'expired' else ar.status end,
           ar.required_approvals,
           (select count(*)::integer from public.runtime_approval_decisions d where d.request_id = ar.id and d.decision = 'approve'),
           ar.expires_at, ar.stale_reason
    from public.runtime_approval_requests ar
    where ar.tool_request_id = p_tool_request_id and ar.tenant_id = v_tenant and ar.agent_id = v_agent;
  if not found then
    return query select 'ok'::text, null::uuid, 'none'::text, null::integer, null::integer, null::timestamptz, null::text;
  end if;
end;
$fn$;
revoke all on function gateway.approval_for_request(text, uuid) from public;
grant execute on function gateway.approval_for_request(text, uuid) to authority_gateway;

create or replace function gateway.approval_by_id(p_credential_secret text, p_approval_id uuid)
returns table (a_status text, a_approval_id uuid, a_state text, a_required integer, a_approved integer, a_expires_at timestamptz, a_reason text, a_tool_request_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_agent uuid;
begin
  select rc.rc_status, rc.rc_tenant_id, rc.rc_agent_id into v_status, v_tenant, v_agent
  from gateway.resolve_credential(p_credential_secret) rc;
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::text, null::integer, null::integer, null::timestamptz, null::text, null::uuid; return;
  end if;
  return query
    select 'ok'::text, ar.id,
           case when ar.status = 'pending' and ar.expires_at <= now() then 'expired' else ar.status end,
           ar.required_approvals,
           (select count(*)::integer from public.runtime_approval_decisions d where d.request_id = ar.id and d.decision = 'approve'),
           ar.expires_at, ar.stale_reason, ar.tool_request_id
    from public.runtime_approval_requests ar
    where ar.id = p_approval_id and ar.tenant_id = v_tenant and ar.agent_id = v_agent;
  if not found then
    return query select 'ok'::text, null::uuid, 'not_found'::text, null::integer, null::integer, null::timestamptz, null::text, null::uuid;
  end if;
end;
$fn$;
revoke all on function gateway.approval_by_id(text, uuid) from public;
grant execute on function gateway.approval_by_id(text, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Human resolution. Runs in the approver's own session (auth.uid()), so the
-- role and self-approval rules are enforced against the real signed-in user.
-- ---------------------------------------------------------------------------
create or replace function public.decide_runtime_approval(p_request_id uuid, p_decision text, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  ar public.runtime_approval_requests%rowtype;
  v_principal uuid;
  v_task_principal uuid;
  v_task_user uuid;
  v_agent_owner uuid;
  v_approvals integer;
  v_reason text;
begin
  if (select auth.uid()) is null then
    raise exception 'decide_runtime_approval() requires an authenticated caller' using errcode = '28000';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject' using errcode = '22023';
  end if;
  select * into ar from public.runtime_approval_requests where id = p_request_id;
  if ar.id is null or not authz.is_member_of(ar.tenant_id) then
    raise exception 'approval request not found' using errcode = 'P0002';
  end if;
  if not authz.has_min_role(ar.tenant_id, 'security_admin') then
    raise exception 'insufficient privileges to decide approvals' using errcode = '42501';
  end if;
  select p.id into v_principal from public.principals p where p.tenant_id = ar.tenant_id and p.user_id = (select auth.uid());
  if v_principal is null then
    raise exception 'no principal for the current user' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.runtime_approval:' || ar.id::text, 0));
  select * into ar from public.runtime_approval_requests where id = p_request_id;

  if ar.status = 'pending' and ar.expires_at <= now() then
    update public.runtime_approval_requests set status = 'expired', resolved_at = now() where id = ar.id;
    return 'expired';
  end if;
  if ar.status <> 'pending' then return ar.status; end if;

  -- Self-approval: neither the task's principal, its initiating user, nor the agent's owner may decide.
  select t.principal_id, t.initiating_user_id into v_task_principal, v_task_user from public.tasks t where t.id = ar.task_id;
  select ag.owner_principal_id into v_agent_owner from public.agents ag where ag.id = ar.agent_id;
  if v_principal = v_task_principal or v_principal = v_agent_owner or v_task_user = (select auth.uid()) then
    raise exception 'you cannot decide an approval for a task or agent you own' using errcode = '42501';
  end if;
  if exists (select 1 from public.runtime_approval_decisions d where d.request_id = ar.id and d.approver_principal_id = v_principal) then
    raise exception 'you have already decided this approval' using errcode = '23505';
  end if;

  -- Stale-at-decision: anything the approver was shown that has since changed.
  if gateway.approval_context_hash(ar.tenant_id, ar.task_id, ar.tool, ar.resource) <> ar.context_hash then
    v_reason := 'CONTEXT_CHANGED';
    update public.runtime_approval_requests set status = 'stale', stale_reason = v_reason, resolved_at = now() where id = ar.id;
    return 'stale';
  end if;

  insert into public.runtime_approval_decisions (tenant_id, request_id, approver_principal_id, decision, note)
  values (ar.tenant_id, ar.id, v_principal, p_decision, nullif(btrim(p_note), ''));

  if p_decision = 'reject' then
    update public.runtime_approval_requests set status = 'rejected', resolved_at = now() where id = ar.id;
    insert into public.execution_events (tenant_id, task_id, tool_request_id, decision_id, event_type, result_status, summary,
      normalized_effect_metadata)
    values (ar.tenant_id, ar.task_id, ar.tool_request_id, ar.authorization_decision_id, 'approval_resolved', 'blocked',
      format('Approval for %s was rejected.', ar.tool), jsonb_build_object('schemaVersion', 1, 'phase', 'approval_rejected'));
    return 'rejected';
  end if;

  select count(*) into v_approvals from public.runtime_approval_decisions d where d.request_id = ar.id and d.decision = 'approve';
  if v_approvals >= ar.required_approvals then
    update public.runtime_approval_requests set status = 'approved', resolved_at = now() where id = ar.id;
    insert into public.execution_events (tenant_id, task_id, tool_request_id, decision_id, event_type, result_status, summary,
      normalized_effect_metadata)
    values (ar.tenant_id, ar.task_id, ar.tool_request_id, ar.authorization_decision_id, 'approval_resolved', 'success',
      format('Approval for %s was granted; the agent may now re-request the capability.', ar.tool),
      jsonb_build_object('schemaVersion', 1, 'phase', 'approval_granted'));
    return 'approved';
  end if;
  return 'pending';
end;
$fn$;
revoke all on function public.decide_runtime_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_runtime_approval(uuid, text, text) to authenticated;

create or replace function public.set_runtime_approval_classes(p_tenant_id uuid, p_classes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_principal uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'set_runtime_approval_classes() requires an authenticated caller' using errcode = '28000';
  end if;
  if p_tenant_id is null or not authz.has_min_role(p_tenant_id, 'security_admin') then
    raise exception 'insufficient privileges to change approval policy' using errcode = '42501';
  end if;
  if not (coalesce(p_classes, '{}'::text[]) <@ array['low', 'medium', 'high']::text[]) then
    raise exception 'classes must be low, medium or high' using errcode = '22023';
  end if;
  select p.id into v_principal from public.principals p where p.tenant_id = p_tenant_id and p.user_id = (select auth.uid());
  insert into public.semantic_settings as s (tenant_id, runtime_approval_classes, updated_at, updated_by_principal_id)
  values (p_tenant_id, coalesce(p_classes, '{}'::text[]), now(), v_principal)
  on conflict (tenant_id) do update
    set runtime_approval_classes = excluded.runtime_approval_classes, updated_at = now(), updated_by_principal_id = v_principal;
  insert into public.semantic_settings_audit (tenant_id, actor_principal_id, previous_settings, new_settings)
  values (p_tenant_id, v_principal, null, jsonb_build_object('runtimeApprovalClasses', coalesce(p_classes, '{}'::text[])));
end;
$fn$;
revoke all on function public.set_runtime_approval_classes(uuid, text[]) from public, anon;
grant execute on function public.set_runtime_approval_classes(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- commit_authorization: gains registry/policy approval narrowing, opens the
-- approval request, mints on an approved replay, and sweeps unused budget.
-- The previous 27-argument signature is dropped so the old behavior cannot be reached.
-- ---------------------------------------------------------------------------
drop function gateway.commit_authorization(
  text, uuid, text, text, text, jsonb, jsonb, uuid, text, text, text, text, integer, text,
  text, text, text, public.semantic_evidence_state, jsonb, text[], public.semantic_risk_level, double precision,
  integer, text, jsonb, text, text
);

create or replace function gateway.commit_authorization(
  p_credential_secret text,
  p_task_id uuid,
  p_tool text,
  p_operation text,
  p_resource text,
  p_args jsonb,
  p_argument_audit jsonb,
  p_plan_node_id uuid,
  p_idempotency_key text,
  p_registry_version text,
  p_compiler_version text,
  p_risk_class text,
  p_max_uses integer,
  p_token_hash text,
  p_sem_provider text,
  p_sem_model text,
  p_sem_model_version text,
  p_sem_state public.semantic_evidence_state,
  p_sem_signals jsonb,
  p_sem_indicators text[],
  p_sem_risk public.semantic_risk_level,
  p_sem_confidence double precision,
  p_sem_latency_ms integer,
  p_sem_input_hash text,
  p_sem_redaction jsonb,
  p_sem_error_category text,
  p_gateway_version text,
  p_registry_requires_approval boolean
)
returns table (
  r_status text,
  r_replayed boolean,
  r_decision_id uuid,
  r_final_decision_id uuid,
  r_tool_request_id uuid,
  r_det_outcome public.authorization_outcome,
  r_final_outcome public.authorization_outcome,
  r_reason_codes text[],
  r_contract_id uuid,
  r_contract_version integer,
  r_semantic_mode public.semantic_mode,
  r_semantic_policy text,
  r_degraded boolean,
  r_degraded_reason text,
  r_narrowed boolean,
  r_capability_id uuid,
  r_capability_expires_at timestamptz,
  r_capability_max_uses integer,
  r_remaining_invocations integer
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_tenant uuid;
  v_agent uuid;
  v_cred uuid;
  v_task_agent uuid;
  v_request_hash text;
  v_args_hash text;
  v_existing_req uuid;
  v_existing_hash text;
  -- deterministic
  v_det public.authorization_outcome;
  v_det_reasons jsonb;
  v_contract_id uuid;
  v_contract_version integer;
  v_contract_expires timestamptz;
  v_action jsonb;
  v_budget_id uuid;
  v_max_per_action integer;
  v_reservable boolean;
  -- settings
  v_mode public.semantic_mode := 'off';
  v_provider text := 'mock';
  v_model text := 'mock-heuristic';
  v_classes text[] := '{}'::text[];
  v_ttl integer := 60;
  v_env public.tenant_environment;
  v_grade boolean;
  v_enforceable boolean;
  v_required boolean;
  v_policy text;
  -- composition
  v_final public.authorization_outcome;
  v_comp_reasons text[];
  v_degraded boolean;
  v_degraded_reason text;
  v_sem_state public.semantic_evidence_state;
  -- ids
  v_request_id uuid;
  v_decision_id uuid := gen_random_uuid();
  v_final_id uuid := gen_random_uuid();
  v_sem_eval_id uuid;
  v_token_id uuid;
  v_token_expires timestamptz;
  v_remaining integer;
  v_cap_after integer;
  v_all_reasons text[];
  v_permits boolean;
  v_replay_reasons text[];
  v_approval_classes text[] := '{}'::text[];
  v_approval_trigger text;
  v_m record;
  v_evidence jsonb;
  v_required_approvals integer;
begin
  if p_tool is null or p_tool !~ '^[a-z0-9_]+\.[a-z0-9_]+$' then
    raise exception 'malformed tool identifier' using errcode = '22023';
  end if;
  if p_operation is null or char_length(btrim(p_operation)) < 1 or char_length(p_operation) > 100 then
    raise exception 'operation is required' using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 1 or char_length(p_idempotency_key) > 200 then
    raise exception 'idempotency key is required and must be 1-200 characters' using errcode = '22023';
  end if;
  if p_registry_version is null or p_compiler_version is null or p_gateway_version is null then
    raise exception 'registry, compiler and gateway versions are required' using errcode = '22023';
  end if;
  if p_risk_class is null or p_risk_class not in ('low', 'medium', 'high') then
    raise exception 'risk class must be low, medium or high' using errcode = '22023';
  end if;
  if p_max_uses is null or p_max_uses not between 1 and 5 then
    raise exception 'max uses must be between 1 and 5' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' or pg_column_size(p_args) > 16384 then
    raise exception 'arguments must be an object of at most 16 KB' using errcode = '22023';
  end if;
  if p_argument_audit is null or pg_column_size(p_argument_audit) > 8192 then
    raise exception 'argument audit is required and must be at most 8 KB' using errcode = '22023';
  end if;
  if p_resource is not null and char_length(p_resource) > 200 then
    raise exception 'resource identifier too long' using errcode = '22023';
  end if;

  select rc.rc_status, rc.rc_tenant_id, rc.rc_agent_id, rc.rc_credential_id into v_status, v_tenant, v_agent, v_cred
  from gateway.resolve_credential(p_credential_secret) rc;

  if v_status <> 'ok' then
    return query select v_status, false, null::uuid, null::uuid, null::uuid, null::public.authorization_outcome,
      null::public.authorization_outcome, '{}'::text[], null::uuid, null::integer, 'off'::public.semantic_mode, 'not_applicable'::text,
      false, null::text, false, null::uuid, null::timestamptz, null::integer, null::integer;
    return;
  end if;

  select t.agent_id into v_task_agent from public.tasks t where t.id = p_task_id and t.tenant_id = v_tenant;
  if v_task_agent is null or v_task_agent <> v_agent then
    return query select case when v_task_agent is null then 'task_not_found' else 'agent_mismatch' end, false,
      null::uuid, null::uuid, null::uuid, null::public.authorization_outcome, null::public.authorization_outcome,
      '{}'::text[], null::uuid, null::integer, 'off'::public.semantic_mode, 'not_applicable'::text,
      false, null::text, false, null::uuid, null::timestamptz, null::integer, null::integer;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.runtime_authorize:' || p_task_id::text, 0));
  -- Unused budget from expired/revoked capabilities is returned before anything is evaluated.
  perform gateway.sweep_task_budgets(p_task_id);

  v_args_hash := encode(extensions.digest(p_args::text, 'sha256'), 'hex');
  v_request_hash := encode(extensions.digest(
    p_tool || '|' || p_operation || '|' || coalesce(p_resource, '') || '|' || v_args_hash || '|' || coalesce(p_plan_node_id::text, ''),
    'sha256'), 'hex');

  select tr.id, tr.request_hash into v_existing_req, v_existing_hash
  from public.tool_requests tr
  where tr.tenant_id = v_tenant and tr.task_id = p_task_id and tr.idempotency_key = p_idempotency_key;

  if v_existing_req is not null then
    if v_existing_hash is distinct from v_request_hash then
      return query select 'idempotency_conflict'::text, false, null::uuid, null::uuid, null::uuid,
        null::public.authorization_outcome, null::public.authorization_outcome, '{}'::text[], null::uuid, null::integer,
        'off'::public.semantic_mode, 'not_applicable'::text, false, null::text, false, null::uuid, null::timestamptz,
        null::integer, null::integer;
      return;
    end if;

    -- An approved runtime approval is turned into a capability here, after every
    -- input is re-checked against CURRENT state (see gateway.mint_approved_capability).
    select m.* into v_m from gateway.mint_approved_capability(
      v_tenant, v_agent, v_cred, p_task_id, v_existing_req, p_tool, p_resource, p_args,
      p_registry_version, p_compiler_version, p_max_uses, p_token_hash) m;
    if v_m.m_status = 'minted' then
      return query
        select 'ok'::text, false, d.id, f.id, d.tool_request_id, d.outcome, 'allow'::public.authorization_outcome,
               array['APPROVAL_GRANTED']::text[] || array(select item ->> 'code' from jsonb_array_elements(d.reason_codes -> 'items') item),
               d.contract_id, d.contract_version, f.semantic_mode, f.semantic_policy, f.degraded, f.degraded_reason,
               f.narrowed, v_m.m_capability_id, v_m.m_expires_at, v_m.m_max_uses, v_m.m_remaining
        from public.authorization_decisions d
        join public.final_decisions f on f.authorization_decision_id = d.id
        where d.tool_request_id = v_existing_req;
      return;
    end if;

    -- Idempotent replay: return the stored result. A capability's plaintext is
    -- never re-shown (only its hash exists); its id/expiry are returned.
    return query
      select 'ok'::text, true, d.id, f.id, d.tool_request_id, d.outcome, f.final_outcome,
             f.composition_reasons || array(select item ->> 'code' from jsonb_array_elements(d.reason_codes -> 'items') item),
             d.contract_id, d.contract_version, f.semantic_mode, f.semantic_policy, f.degraded, f.degraded_reason,
             f.narrowed, ct.id, ct.expires_at, ct.max_uses,
             (select cap.max_invocations - cap.consumed_uses from public.capabilities cap where cap.id = ct.budget_capability_id)
      from public.authorization_decisions d
      join public.final_decisions f on f.authorization_decision_id = d.id
      left join public.capability_tokens ct on ct.final_decision_id = f.id
      where d.tool_request_id = v_existing_req;
    if found then return; end if;
    -- A pre-Part-6 request (no final decision row): its decision stands as final.
    return query
      select 'ok'::text, true, d.id, null::uuid, d.tool_request_id, d.outcome, d.outcome,
             array(select item ->> 'code' from jsonb_array_elements(d.reason_codes -> 'items') item),
             d.contract_id, d.contract_version, 'off'::public.semantic_mode, 'not_applicable'::text, false, null::text,
             false, null::uuid, null::timestamptz, null::integer, null::integer
      from public.authorization_decisions d where d.tool_request_id = v_existing_req;
    return;
  end if;

  -- Deterministic evaluation: authoritative, under the lock, arguments used in memory only.
  select ed.ed_outcome, ed.ed_reasons, ed.ed_contract_id, ed.ed_contract_version, ed.ed_contract_expires_at,
         ed.ed_action, ed.ed_budget_capability_id, ed.ed_max_per_action, ed.ed_reservable
    into v_det, v_det_reasons, v_contract_id, v_contract_version, v_contract_expires,
         v_action, v_budget_id, v_max_per_action, v_reservable
  from gateway.evaluate_deterministic(v_tenant, p_task_id, p_tool, p_args, p_registry_version, p_compiler_version, p_max_uses) ed;

  -- Semantic settings are read here, in the transaction, not taken from the caller.
  select ss.mode, ss.provider, ss.model, ss.semantic_required_classes, ss.capability_ttl_seconds, ss.runtime_approval_classes
    into v_mode, v_provider, v_model, v_classes, v_ttl, v_approval_classes
  from public.semantic_settings ss where ss.tenant_id = v_tenant;
  if not found then
    v_mode := 'off'; v_provider := 'mock'; v_model := 'mock-heuristic'; v_classes := '{}'::text[]; v_ttl := 60;
  end if;
  select te.environment into v_env from public.tenants te where te.id = v_tenant;
  v_grade := gateway.provider_enforcement_grade(v_provider, v_env);

  -- Evidence must come from the provider the tenant configured; anything else is ignored as if absent.
  if p_sem_state is not null and p_sem_provider is not distinct from v_provider
     and (v_provider <> 'openai_compatible' or p_sem_model is not distinct from v_model)
     and v_mode <> 'off' then
    v_sem_state := p_sem_state;
    if (p_sem_state = 'ok') <> (p_sem_signals is not null) then
      raise exception 'signals must be present exactly when state is ok' using errcode = '22023';
    end if;
    if p_sem_signals is not null and not authz.valid_semantic_signals(p_sem_signals) then
      raise exception 'signals violate the evidence contract' using errcode = '22023';
    end if;
    if p_sem_state <> 'ok' and p_sem_risk <> 'unknown' then
      raise exception 'a non-ok evaluation must have unknown risk' using errcode = '22023';
    end if;
    if p_sem_state = 'ok' and (p_sem_risk is null or p_sem_risk = 'unknown') then
      raise exception 'an ok evaluation must carry a known risk level' using errcode = '22023';
    end if;
    if p_sem_input_hash is null or p_sem_input_hash !~ '^[0-9a-f]{64}$' or p_sem_redaction is null
       or pg_column_size(p_sem_redaction) > 2048 or p_sem_model_version is null then
      raise exception 'semantic evidence is malformed' using errcode = '22023';
    end if;
  else
    v_sem_state := null;
  end if;

  v_enforceable := (v_mode = 'enforce' and v_grade and v_sem_state is not null);
  v_required := (v_mode = 'enforce' and p_risk_class = any(v_classes));
  v_policy := case when v_mode = 'off' then 'not_applicable' when v_required then 'required' else 'optional' end;

  select cp.c_final, cp.c_reasons, cp.c_degraded, cp.c_degraded_reason
    into v_final, v_comp_reasons, v_degraded, v_degraded_reason
  from gateway.compose_outcome(v_det, v_mode, v_sem_state,
    case when v_sem_state is null then null else p_sem_risk end, v_required, v_enforceable) cp;

  -- Policy/registry approval requirements narrow an allow to require_approval.
  -- Like every composition step this can only make the outcome stricter.
  if v_final in ('allow', 'allow_constrained') then
    if coalesce(p_registry_requires_approval, false) then
      v_final := 'require_approval'; v_comp_reasons := v_comp_reasons || array['REGISTRY_REQUIRES_APPROVAL'];
      v_approval_trigger := 'registry_requires_approval';
    elsif p_risk_class = any (coalesce(v_approval_classes, '{}'::text[])) then
      v_final := 'require_approval'; v_comp_reasons := v_comp_reasons || array['POLICY_REQUIRES_APPROVAL'];
      v_approval_trigger := 'policy_class';
    end if;
  end if;
  if v_final = 'require_approval' and v_approval_trigger is null then v_approval_trigger := 'semantic_high_risk'; end if;

  v_permits := v_final in ('allow', 'allow_constrained');
  v_all_reasons := v_comp_reasons || array(select item ->> 'code' from jsonb_array_elements(v_det_reasons) item);

  -- ---- persistence ------------------------------------------------------
  insert into public.tool_requests (
    tenant_id, task_id, plan_id, plan_node_id, agent_id, tool, operation, resource,
    normalized_arguments, destination_metadata, provenance, idempotency_key, request_hash,
    argument_audit, arguments_redacted, arguments_hash
  ) values (
    v_tenant, p_task_id, null, p_plan_node_id, v_agent, p_tool, p_operation, p_resource,
    '{"schemaVersion":1,"values":{}}'::jsonb, null, 'agent_proposed', p_idempotency_key, v_request_hash,
    p_argument_audit, true, v_args_hash
  ) returning id into v_request_id;

  -- Budget is reserved only for a FINAL allow: a semantic narrowing never consumes it.
  if v_permits and v_reservable then
    if v_budget_id is null then
      insert into public.capabilities (
        tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
        status, max_invocations, consumed_uses, expires_at, contract_id
      ) values (
        v_tenant, p_task_id, v_decision_id, v_agent, p_tool,
        jsonb_build_object('schemaVersion', 1, 'items', coalesce(v_action -> 'constraints', '[]'::jsonb)),
        'active', v_max_per_action, p_max_uses, v_contract_expires, v_contract_id
      ) returning id into v_budget_id;
    else
      update public.capabilities set consumed_uses = consumed_uses + p_max_uses where id = v_budget_id;
    end if;
  else
    v_budget_id := case when v_permits then v_budget_id else null end;
  end if;

  insert into public.authorization_decisions (
    id, tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome, reason_codes, latency_ms, capability_id
  ) values (
    v_decision_id, v_tenant, p_task_id, v_request_id, v_contract_id, v_contract_version, v_det,
    jsonb_build_object('schemaVersion', 1, 'items', v_det_reasons), 0,
    case when v_permits and v_reservable then v_budget_id else null end
  );

  if v_sem_state is not null then
    insert into public.semantic_evaluations (
      tenant_id, task_id, tool_request_id, authorization_decision_id, agent_id, mode, enforcement_grade,
      provider, model, model_version, state, signals, indicators, risk_level, confidence, latency_ms,
      input_hash, redaction_summary, error_category
    ) values (
      v_tenant, p_task_id, v_request_id, v_decision_id, v_agent, v_mode, v_grade,
      p_sem_provider, p_sem_model, p_sem_model_version, v_sem_state, p_sem_signals, coalesce(p_sem_indicators, '{}'::text[]),
      p_sem_risk, coalesce(p_sem_confidence, 0), coalesce(p_sem_latency_ms, 0),
      p_sem_input_hash, p_sem_redaction, p_sem_error_category
    ) returning id into v_sem_eval_id;
  end if;

  insert into public.final_decisions (
    id, tenant_id, task_id, tool_request_id, authorization_decision_id, semantic_evaluation_id,
    deterministic_outcome, final_outcome, semantic_mode, semantic_policy, risk_class,
    composition_reasons, degraded, degraded_reason, narrowed, gateway_version
  ) values (
    v_final_id, v_tenant, p_task_id, v_request_id, v_decision_id, v_sem_eval_id,
    v_det, v_final, v_mode, v_policy, p_risk_class,
    v_comp_reasons, v_degraded, v_degraded_reason, v_final <> v_det, p_gateway_version
  );

  if v_final = 'require_approval' and v_det in ('allow', 'allow_constrained') then
    v_required_approvals := case when p_risk_class = 'high' then 2 else 1 end;
    v_evidence := jsonb_build_object('schemaVersion', 1, 'deterministicOutcome', v_det, 'finalOutcome', v_final,
      'reasonCodes', to_jsonb(v_comp_reasons || array(select item ->> 'code' from jsonb_array_elements(v_det_reasons) item)),
      'semantic', case when v_sem_state is null then null else jsonb_build_object('state', v_sem_state,
         'riskLevel', p_sem_risk, 'indicators', to_jsonb(coalesce(p_sem_indicators, '{}'::text[]))) end);
    insert into public.runtime_approval_requests (
      tenant_id, task_id, agent_id, tool_request_id, authorization_decision_id, final_decision_id, contract_id,
      contract_version, tool, operation, resource, arguments_hash, request_hash, risk_class, trigger_kind, evidence,
      context_hash, required_approvals, expires_at
    ) values (
      v_tenant, p_task_id, v_agent, v_request_id, v_decision_id, v_final_id, v_contract_id,
      v_contract_version, p_tool, p_operation, p_resource, v_args_hash, v_request_hash, p_risk_class, v_approval_trigger, v_evidence,
      gateway.approval_context_hash(v_tenant, p_task_id, p_tool, p_resource), v_required_approvals, now() + interval '1 hour'
    );
    insert into public.execution_events (tenant_id, task_id, tool_request_id, decision_id, event_type, result_status, summary,
      normalized_effect_metadata)
    values (v_tenant, p_task_id, v_request_id, v_decision_id, 'approval_requested', 'blocked',
      format('Runtime call to %s needs approval (%s).', p_tool, v_approval_trigger),
      jsonb_build_object('schemaVersion', 1, 'phase', 'approval_requested'));
  end if;

  if v_permits and v_reservable then
    if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'a capability token hash is required for an allow' using errcode = '22023';
    end if;
    v_token_expires := least(now() + make_interval(secs => v_ttl), v_contract_expires);
    insert into public.capability_tokens (
      tenant_id, agent_id, task_id, credential_id, contract_id, contract_version, authorization_decision_id,
      final_decision_id, budget_capability_id, tool, operation, resource, resource_constraints, arguments_hash,
      max_uses, expires_at, token_hash
    ) values (
      v_tenant, v_agent, p_task_id, v_cred, v_contract_id, v_contract_version, v_decision_id,
      v_final_id, v_budget_id, p_tool, p_operation, p_resource,
      jsonb_build_object('schemaVersion', 1, 'items', coalesce(v_action -> 'constraints', '[]'::jsonb)),
      v_args_hash, p_max_uses, v_token_expires, p_token_hash
    ) returning id into v_token_id;

    insert into public.execution_events (
      tenant_id, task_id, capability_id, tool_request_id, decision_id, event_type, result_status, summary
    ) values (
      v_tenant, p_task_id, v_budget_id, v_request_id, v_decision_id, 'capability_issued', 'success',
      format('Capability issued for %s (simulation only — no external tool executes in this phase).', p_tool)
    );

    select cap.max_invocations - cap.consumed_uses into v_remaining from public.capabilities cap where cap.id = v_budget_id;
  end if;

  insert into public.execution_events (
    tenant_id, task_id, capability_id, tool_request_id, decision_id, event_type, result_status, summary
  ) values (
    v_tenant, p_task_id, case when v_permits and v_reservable then v_budget_id else null end, v_request_id, v_decision_id,
    'request_evaluated', case when v_permits then 'success' else 'blocked' end::public.execution_outcome,
    format('Runtime call to %s: deterministic %s, final %s (semantic %s).', p_tool, v_det, v_final, v_mode)
  );

  return query select 'ok'::text, false, v_decision_id, v_final_id, v_request_id, v_det, v_final, v_all_reasons,
    v_contract_id, v_contract_version, v_mode, v_policy, v_degraded, v_degraded_reason, v_final <> v_det,
    v_token_id, v_token_expires, case when v_token_id is null then null else p_max_uses end, v_remaining;
end;
$fn$;

revoke all on function gateway.commit_authorization(
  text, uuid, text, text, text, jsonb, jsonb, uuid, text, text, text, text, integer, text,
  text, text, text, public.semantic_evidence_state, jsonb, text[], public.semantic_risk_level, double precision,
  integer, text, jsonb, text, text, boolean
) from public;
grant execute on function gateway.commit_authorization(
  text, uuid, text, text, text, jsonb, jsonb, uuid, text, text, text, text, integer, text,
  text, text, text, public.semantic_evidence_state, jsonb, text[], public.semantic_risk_level, double precision,
  integer, text, jsonb, text, text, boolean
) to authority_gateway;
