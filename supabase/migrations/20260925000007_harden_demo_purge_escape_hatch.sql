-- Part 3A: harden the demo-purge escape hatch — require the trusted role too.
--
-- Every append-only/immutability trigger's escape hatch previously checked
-- only `current_setting('authority.allow_demo_purge', true) = 'on'`. That
-- flag is genuinely unreachable through the actual client attack surface
-- today — confirmed live: calling it through the real PostgREST REST API
-- returns 404 PGRST202 (only functions in the exposed `public` schema are
-- routable at all; `pg_catalog.set_config` is not one of them), even though
-- the raw `has_function_privilege('authenticated', ...)` grant bit is true
-- (a default-PUBLIC artifact of it being a built-in, not itself a
-- vulnerability). Relying on that alone is still fragile: it depends on
-- today's PostgREST schema-exposure configuration never changing and on no
-- future exposed function ever calling `set_config` on a caller's behalf.
--
-- Every escape hatch now requires BOTH the transaction-local flag AND
-- execution as this project's trusted function-owner role. Inside a
-- SECURITY DEFINER RPC's execution (install_demo_workspace,
-- reset_demo_workspace), `current_user` is the function's owner for the
-- duration of that call and everything it triggers — including these
-- triggers — so this check is meaningful, not decorative. A normal
-- authenticated caller cannot forge `current_user`; it is not a session
-- variable a client can set.

create or replace function authz.forbid_update_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('authority.allow_demo_purge', true) = 'on' and current_user = 'postgres' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  raise exception 'rows in % are append-only and cannot be updated or deleted', tg_table_name
    using errcode = '23514';
end;
$$;

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

  if not authz.is_allowed_contract_transition(old.contract_status, new.contract_status) then
    raise exception 'invalid task authority contract transition: % -> %', old.contract_status, new.contract_status
      using errcode = '23514';
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
    raise exception 'a task authority contract''s content is immutable; only lifecycle status and its paired metadata may change'
      using errcode = '23514';
  end if;

  if old.contract_status = 'proposed' and new.contract_status = 'awaiting_approval' then
    if new.submitted_by_principal_id is null or new.submitted_at is null then
      raise exception 'submitting for approval must record submitted_by_principal_id and submitted_at' using errcode = '23514';
    end if;
    if old.submitted_by_principal_id is not null or old.submitted_at is not null then
      raise exception 'a contract cannot be resubmitted for approval' using errcode = '23514';
    end if;
    if new.rejected_by_principal_id is not null or new.rejected_at is not null or new.rejection_reason is not null then
      raise exception 'submitting for approval must not set rejection fields' using errcode = '23514';
    end if;

  elsif old.contract_status = 'proposed' and new.contract_status = 'rejected' then
    if new.rejected_by_principal_id is null or new.rejected_at is null or new.rejection_reason is null then
      raise exception 'rejecting must record rejected_by_principal_id, rejected_at and rejection_reason' using errcode = '23514';
    end if;
    if new.submitted_by_principal_id is not null or new.submitted_at is not null then
      raise exception 'a contract rejected directly from proposed never had a submission to preserve' using errcode = '23514';
    end if;

  elsif old.contract_status = 'awaiting_approval' and new.contract_status = 'rejected' then
    if new.rejected_by_principal_id is null or new.rejected_at is null or new.rejection_reason is null then
      raise exception 'rejecting must record rejected_by_principal_id, rejected_at and rejection_reason' using errcode = '23514';
    end if;
    if (new.submitted_by_principal_id, new.submitted_at) is distinct from (old.submitted_by_principal_id, old.submitted_at) then
      raise exception 'rejecting must not alter the earlier submission record' using errcode = '23514';
    end if;

  end if;

  return new;
end;
$$;

create or replace function authz.enforce_policy_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('authority.allow_demo_purge', true) = 'on' and current_user = 'postgres' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if old.status = 'active' then
    raise exception 'an active policy version is immutable; create a new version instead'
      using errcode = '23514';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;
