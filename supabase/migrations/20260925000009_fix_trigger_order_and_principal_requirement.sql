-- Corrective, found by running the pgTAP suite against the real deployed
-- schema (exactly the workflow this project uses to catch its own defects
-- rather than assume correctness):
--
-- 1. Trigger check order. authz.enforce_contract_immutable() checked
--    transition legality before content immutability, so a same-status
--    content-changing UPDATE (e.g. changing spec_version while
--    contract_status stays 'active') failed with "invalid transition:
--    active -> active" instead of a content-immutability message — 'active
--    -> active' was never in the transition matrix at all, since a
--    same-status pair was deliberately excluded (there is never a
--    legitimate reason for a real no-op transition). Reordered: content
--    immutability is now checked unconditionally, before any transition
--    logic runs, and only a *changed* status is checked against the
--    transition matrix at all.
--
-- 2. Principal requirement on submit/reject. The original RPCs raised an
--    exception if the calling user had no `principals` row linking their
--    auth id in this tenant. Verified this is a real, practical usability
--    blocker, not just a test-fixture inconvenience: principals are today
--    created only by install_demo_workspace() (with fixture identities
--    never linked to a real auth user) — no onboarding path creates one
--    for an ordinary signed-up user, so a genuine tenant owner or developer
--    would have zero principals and could never submit or reject a
--    contract at all. Relaxed to best-effort, matching the already-
--    established pattern in resolveApprovalAction (Part 2B.2): submission/
--    rejection is still recorded — timestamp and (for rejection) reason are
--    always required, since neither depends on a principal existing — but
--    `submitted_by_principal_id` / `rejected_by_principal_id` may be null
--    when no principal maps to this caller, rather than blocking the
--    action outright.

create or replace function authz.enforce_contract_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_content_changed boolean;
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
    new.data_flow_bindings, new.required_approvals, new.registry_version, new.compiler_version,
    new.input_hash, new.output_hash, new.created_at
  ) is distinct from (
    old.tenant_id, old.task_id, old.plan_id, old.version, old.spec_version, old.allowed_actions,
    old.forbidden_resources, old.forbidden_operations, old.ephemeral_limits, old.source_evidence_metadata,
    old.data_flow_bindings, old.required_approvals, old.registry_version, old.compiler_version,
    old.input_hash, old.output_hash, old.created_at
  );

  if v_content_changed then
    raise exception 'a task authority contract is immutable; create a new version instead'
      using errcode = '23514';
  end if;

  if old.contract_status <> new.contract_status then
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
      if new.rejected_by_principal_id is not null or new.rejected_at is not null or new.rejection_reason is not null then
        raise exception 'submitting for approval must not set rejection fields' using errcode = '23514';
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

    end if;
  end if;

  return new;
end;
$$;

create or replace function public.submit_contract_for_approval(p_contract_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_principal_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'submit_contract_for_approval() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.task_authority_contracts where id = p_contract_id;
  if v_tenant_id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;

  if not authz.has_min_role(v_tenant_id, 'developer') then
    raise exception 'insufficient privileges to submit this contract for approval' using errcode = '42501';
  end if;

  -- Best-effort: not every authenticated user has a principal record in
  -- this tenant. The submission is still recorded either way.
  select id into v_principal_id
  from public.principals
  where tenant_id = v_tenant_id and user_id = (select auth.uid());

  update public.task_authority_contracts
  set contract_status = 'awaiting_approval', submitted_by_principal_id = v_principal_id, submitted_at = now()
  where id = p_contract_id and contract_status = 'proposed';

  if not found then
    raise exception 'contract is not in a state that can be submitted for approval' using errcode = '23514';
  end if;
end;
$fn$;

create or replace function public.reject_contract(p_contract_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_status public.contract_status;
  v_principal_id uuid;
  v_reason text;
begin
  if (select auth.uid()) is null then
    raise exception 'reject_contract() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id, contract_status into v_tenant_id, v_status
  from public.task_authority_contracts where id = p_contract_id;
  if v_tenant_id is null then
    raise exception 'contract not found' using errcode = 'P0002';
  end if;

  if v_status = 'awaiting_approval' then
    if not authz.has_min_role(v_tenant_id, 'security_admin') then
      raise exception 'insufficient privileges to reject a contract awaiting approval' using errcode = '42501';
    end if;
  else
    if not authz.has_min_role(v_tenant_id, 'developer') then
      raise exception 'insufficient privileges to reject this contract' using errcode = '42501';
    end if;
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 then
    raise exception 'a rejection reason is required' using errcode = '22023';
  end if;
  if char_length(v_reason) > 2000 then
    raise exception 'rejection reason exceeds maximum length' using errcode = '22023';
  end if;

  -- Best-effort, same reasoning as submit_contract_for_approval().
  select id into v_principal_id
  from public.principals
  where tenant_id = v_tenant_id and user_id = (select auth.uid());

  update public.task_authority_contracts
  set contract_status = 'rejected', rejected_by_principal_id = v_principal_id, rejected_at = now(), rejection_reason = v_reason
  where id = p_contract_id and contract_status in ('proposed', 'awaiting_approval');

  if not found then
    raise exception 'contract is not in a state that can be rejected' using errcode = '23514';
  end if;
end;
$fn$;
