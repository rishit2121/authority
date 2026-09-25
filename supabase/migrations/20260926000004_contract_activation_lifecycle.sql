-- Part 3B: activation, revocation, expiration and supersession columns and
-- transitions for task_authority_contracts.
--
-- `required_approvals_spec` is compiled-contract content, not lifecycle
-- metadata: it is the TypeScript approval-rule deriver's output at proposal
-- time, and is frozen by the immutability trigger exactly like
-- `allowed_actions` — a later policy change cannot retroactively change what
-- a given contract version required approval for. Recomputing it against
-- *current* policies happens only as part of proposing a brand new
-- contract version, never by mutating an existing one (see
-- activate_task_contract()'s module doc below for what re-verification
-- before activation does and does not trust).

alter table public.task_authority_contracts
  add column required_approvals_spec jsonb,
  add column activated_at timestamptz,
  add column activated_by_principal_id uuid,
  -- Absolute, computed once at activation from ephemeral_limits.expiresInSeconds.
  -- Part 3B has no runtime consumption path yet, but everything that will
  -- ever ask "is this contract currently authoritative" must treat a
  -- past-due expires_at as authoritative-no regardless of contract_status —
  -- see lib/authorization/contract-runtime.ts's isContractCurrentlyActive().
  -- contract_status = 'active' is necessary, never sufficient, on its own.
  add column expires_at timestamptz,
  add column revoked_at timestamptz,
  add column revoked_by_principal_id uuid,
  add column revocation_reason text,
  add column superseded_at timestamptz,
  add column superseded_by_contract_id uuid;

alter table public.task_authority_contracts
  add constraint tac_required_approvals_spec_versioned
    check (demo_key is not null or (required_approvals_spec is not null and authz.has_allowed_schema_version(required_approvals_spec, array[1]))),
  add constraint tac_required_approvals_spec_bounded
    check (required_approvals_spec is null or pg_column_size(required_approvals_spec) <= 8192),
  add constraint tac_revocation_reason_bounded
    check (revocation_reason is null or char_length(revocation_reason) <= 2000),
  add constraint tac_activated_by_principal_fk
    foreign key (activated_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  add constraint tac_revoked_by_principal_fk
    foreign key (revoked_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  add constraint tac_superseded_by_contract_fk
    foreign key (superseded_by_contract_id, tenant_id) references public.task_authority_contracts (id, tenant_id);

-- Single active contract per task, enforced independently of any RPC's own
-- logic: even a buggy or bypassed activation path cannot produce two.
create unique index task_authority_contracts_one_active_per_task
  on public.task_authority_contracts (task_id)
  where contract_status = 'active';

create or replace function authz.is_allowed_contract_transition(
  p_old public.contract_status,
  p_new public.contract_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_old is null or p_new is null then false
    when p_old = 'draft' and p_new = 'proposed' then true
    when p_old = 'proposed' and p_new = 'awaiting_approval' then true
    when p_old = 'proposed' and p_new = 'rejected' then true
    when p_old = 'awaiting_approval' and p_new = 'rejected' then true
    -- New in Part 3B: activation is reachable directly from "proposed" only
    -- when the contract required zero approvals (activate_task_contract()
    -- itself enforces that; the transition matrix only says the *shape* is
    -- legal, never that it's unconditionally allowed).
    when p_old = 'proposed' and p_new = 'active' then true
    when p_old = 'awaiting_approval' and p_new = 'active' then true
    when p_old = 'active' and p_new = 'expired' then true
    when p_old = 'active' and p_new = 'revoked' then true
    when p_old = 'active' and p_new = 'superseded' then true
    else false
  end;
$$;

create or replace function authz.enforce_contract_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_content_changed boolean;
  v_lifecycle_changed boolean;
begin
  if current_setting('authority.allow_demo_purge', true) = 'on' and current_user = 'postgres' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'a task authority contract cannot be deleted' using errcode = '23514';
  end if;

  v_content_changed := (
    new.tenant_id, new.task_id, new.plan_id, new.version, new.spec_version, new.allowed_actions,
    new.forbidden_resources, new.forbidden_operations, new.ephemeral_limits, new.source_evidence_metadata,
    new.data_flow_bindings, new.required_approvals, new.required_approvals_spec, new.registry_version,
    new.compiler_version, new.input_hash, new.output_hash, new.created_at
  ) is distinct from (
    old.tenant_id, old.task_id, old.plan_id, old.version, old.spec_version, old.allowed_actions,
    old.forbidden_resources, old.forbidden_operations, old.ephemeral_limits, old.source_evidence_metadata,
    old.data_flow_bindings, old.required_approvals, old.required_approvals_spec, old.registry_version,
    old.compiler_version, old.input_hash, old.output_hash, old.created_at
  );

  if v_content_changed then
    raise exception 'a task authority contract is immutable; create a new version instead'
      using errcode = '23514';
  end if;

  v_lifecycle_changed := (
    new.submitted_by_principal_id, new.submitted_at,
    new.rejected_by_principal_id, new.rejected_at, new.rejection_reason,
    new.activated_at, new.activated_by_principal_id, new.expires_at,
    new.revoked_at, new.revoked_by_principal_id, new.revocation_reason,
    new.superseded_at, new.superseded_by_contract_id
  ) is distinct from (
    old.submitted_by_principal_id, old.submitted_at,
    old.rejected_by_principal_id, old.rejected_at, old.rejection_reason,
    old.activated_at, old.activated_by_principal_id, old.expires_at,
    old.revoked_at, old.revoked_by_principal_id, old.revocation_reason,
    old.superseded_at, old.superseded_by_contract_id
  );

  if old.contract_status = new.contract_status then
    if v_lifecycle_changed then
      raise exception 'lifecycle metadata may only change alongside a status transition' using errcode = '23514';
    end if;
    return new;
  end if;

  if not authz.is_allowed_contract_transition(old.contract_status, new.contract_status) then
    raise exception 'invalid task authority contract transition: % -> %', old.contract_status, new.contract_status
      using errcode = '23514';
  end if;

  if old.contract_status = 'proposed' and new.contract_status = 'awaiting_approval' then
    if new.submitted_at is null then
      raise exception 'submitting for approval must record submitted_at' using errcode = '23514';
    end if;
    if old.submitted_at is not null then
      raise exception 'a contract cannot be resubmitted for approval' using errcode = '23514';
    end if;
    if (new.rejected_by_principal_id, new.rejected_at, new.rejection_reason,
        new.activated_at, new.activated_by_principal_id, new.expires_at,
        new.revoked_at, new.revoked_by_principal_id, new.revocation_reason,
        new.superseded_at, new.superseded_by_contract_id) is distinct from
       (null, null, null, null, null, null, null, null, null, null, null) then
      raise exception 'submitting for approval must not set any other lifecycle field' using errcode = '23514';
    end if;

  elsif old.contract_status = 'proposed' and new.contract_status = 'rejected' then
    if new.rejected_at is null or new.rejection_reason is null then
      raise exception 'rejecting must record rejected_at and rejection_reason' using errcode = '23514';
    end if;
    if new.submitted_at is not null then
      raise exception 'a contract rejected directly from proposed never had a submission to preserve' using errcode = '23514';
    end if;

  elsif old.contract_status = 'awaiting_approval' and new.contract_status = 'rejected' then
    if new.rejected_at is null or new.rejection_reason is null then
      raise exception 'rejecting must record rejected_at and rejection_reason' using errcode = '23514';
    end if;
    if (new.submitted_by_principal_id, new.submitted_at) is distinct from (old.submitted_by_principal_id, old.submitted_at) then
      raise exception 'rejecting must not alter the earlier submission record' using errcode = '23514';
    end if;

  elsif old.contract_status in ('proposed', 'awaiting_approval') and new.contract_status = 'active' then
    if new.activated_at is null or new.expires_at is null then
      raise exception 'activating must record activated_at and expires_at' using errcode = '23514';
    end if;
    if (new.rejected_by_principal_id, new.rejected_at, new.rejection_reason,
        new.revoked_at, new.revoked_by_principal_id, new.revocation_reason,
        new.superseded_at, new.superseded_by_contract_id) is distinct from
       (null, null, null, null, null, null, null, null) then
      raise exception 'activating must not set rejection, revocation or supersession fields' using errcode = '23514';
    end if;
    if (new.submitted_by_principal_id, new.submitted_at) is distinct from (old.submitted_by_principal_id, old.submitted_at) then
      raise exception 'activating must not alter the earlier submission record' using errcode = '23514';
    end if;

  elsif old.contract_status = 'active' and new.contract_status = 'revoked' then
    if new.revoked_at is null or new.revocation_reason is null then
      raise exception 'revoking must record revoked_at and revocation_reason' using errcode = '23514';
    end if;
    if (new.activated_at, new.activated_by_principal_id, new.expires_at) is distinct from
       (old.activated_at, old.activated_by_principal_id, old.expires_at) then
      raise exception 'revoking must not alter the earlier activation record' using errcode = '23514';
    end if;

  elsif old.contract_status = 'active' and new.contract_status = 'expired' then
    if (new.activated_at, new.activated_by_principal_id, new.expires_at) is distinct from
       (old.activated_at, old.activated_by_principal_id, old.expires_at) then
      raise exception 'expiring must not alter the earlier activation record' using errcode = '23514';
    end if;
    if (new.revoked_at, new.revoked_by_principal_id, new.revocation_reason,
        new.superseded_at, new.superseded_by_contract_id) is distinct from
       (null, null, null, null, null) then
      raise exception 'expiring must not set revocation or supersession fields' using errcode = '23514';
    end if;

  elsif old.contract_status = 'active' and new.contract_status = 'superseded' then
    if new.superseded_at is null or new.superseded_by_contract_id is null then
      raise exception 'superseding must record superseded_at and superseded_by_contract_id' using errcode = '23514';
    end if;
    if (new.activated_at, new.activated_by_principal_id, new.expires_at) is distinct from
       (old.activated_at, old.activated_by_principal_id, old.expires_at) then
      raise exception 'superseding must not alter the earlier activation record' using errcode = '23514';
    end if;
    if (new.revoked_at, new.revoked_by_principal_id, new.revocation_reason) is distinct from (null, null, null) then
      raise exception 'superseding must not set revocation fields' using errcode = '23514';
    end if;

  end if;

  return new;
end;
$$;
