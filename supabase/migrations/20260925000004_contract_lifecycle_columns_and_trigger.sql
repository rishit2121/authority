-- Part 3A: contract compilation columns and the corrected lifecycle trigger.
--
-- Legacy-row preflight (queried live before drafting this migration):
-- task_authority_contracts total=4, all demo_key IS NOT NULL, all
-- status='active'. Every status-conditioned check below is satisfied by
-- every existing row today via the `demo_key is not null` escape clause;
-- zero non-demo legacy rows exist. `demo_key` cannot be used as a bypass
-- going forward — no RPC in this migration accepts a demo_key parameter or
-- ever sets it from any caller-supplied value.
--
-- Audit identity (submitted_by / rejected_by): NOT a reference to
-- auth.users. auth.users(id) on delete set null already exists on this same
-- table's `created_by` column (Part 2B.1) and on policies.created_by — and
-- both predate this migration's active-row immutability trigger already
-- rejecting an UPDATE on an active row (a SET NULL cascade from a user
-- deletion would perform exactly such an UPDATE). That is a real,
-- pre-existing Part 2B.1 defect, verified and documented in this project's
-- security review report; this migration does not touch created_by on
-- either table — broadening this migration into an auth.users deletion
-- redesign was not asked for, and the new columns below sidestep the
-- problem entirely by referencing `principals` instead, which is durable by
-- design (principals.user_id already decouples a principal's existence from
-- the underlying auth account via its own `on delete set null`, and no
-- authenticated role or RPC in this schema can delete a principal row at
-- all — only the demo-purge escape hatch can, which never touches real
-- data). The composite tenant-FK pattern is used, matching every other
-- cross-table reference in this schema.

alter table public.task_authority_contracts
  add column registry_version text,
  add column compiler_version text,
  add column input_hash text,
  add column output_hash text,
  add column data_flow_bindings jsonb,
  add column required_approvals jsonb,
  add column forbidden_operations text[] not null default '{}',
  add column submitted_by_principal_id uuid,
  add column submitted_at timestamptz,
  add column rejected_by_principal_id uuid,
  add column rejected_at timestamptz,
  add column rejection_reason text;

alter table public.task_authority_contracts
  add constraint tac_submitted_by_principal_fk
    foreign key (submitted_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  add constraint tac_rejected_by_principal_fk
    foreign key (rejected_by_principal_id, tenant_id) references public.principals (id, tenant_id);

alter table public.task_authority_contracts
  add constraint tac_registry_version_required
    check (demo_key is not null or registry_version is not null),
  add constraint tac_compiler_version_required
    check (demo_key is not null or compiler_version is not null),
  add constraint tac_input_hash_format
    check (demo_key is not null or (input_hash is not null and input_hash ~ '^[0-9a-f]{64}$')),
  add constraint tac_output_hash_format
    check (demo_key is not null or (output_hash is not null and output_hash ~ '^[0-9a-f]{64}$')),
  add constraint tac_data_flow_bindings_versioned
    check (demo_key is not null or (data_flow_bindings is not null and authz.has_allowed_schema_version(data_flow_bindings, array[1]))),
  add constraint tac_required_approvals_versioned
    check (demo_key is not null or (required_approvals is not null and authz.has_allowed_schema_version(required_approvals, array[1]))),
  add constraint tac_data_flow_bindings_bounded
    check (data_flow_bindings is null or pg_column_size(data_flow_bindings) <= 16384),
  add constraint tac_required_approvals_bounded
    check (required_approvals is null or pg_column_size(required_approvals) <= 4096),
  add constraint tac_rejection_reason_bounded
    check (rejection_reason is null or char_length(rejection_reason) <= 2000);

-- Idempotency/compilation identity: (task_id, plan_id, registry_version,
-- compiler_version, input_hash). A different compiler_version is, by
-- construction, a different identity — never deduplicated against a prior
-- compilation, since a new compiler build may legitimately produce a
-- different normalized output from the same plan and registry.
alter table public.task_authority_contracts
  add column plan_id uuid;

alter table public.task_authority_contracts
  add constraint tac_plan_fk foreign key (plan_id, tenant_id) references public.plans (id, tenant_id),
  add constraint tac_plan_id_required check (demo_key is not null or plan_id is not null);

create unique index tac_compilation_identity_idx
  on public.task_authority_contracts (task_id, plan_id, registry_version, compiler_version, input_hash)
  where demo_key is null;

-- The transition matrix. No entry leads into 'active' — that edge does not
-- exist here at all; Part 3B adds it in its own migration, paired with
-- whichever activation-trust design is chosen.
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
    when p_old = 'active' and p_new = 'expired' then true
    when p_old = 'active' and p_new = 'revoked' then true
    when p_old = 'active' and p_new = 'superseded' then true
    else false
  end;
$$;

revoke all on function authz.is_allowed_contract_transition(public.contract_status, public.contract_status) from public, anon;
grant execute on function authz.is_allowed_contract_transition(public.contract_status, public.contract_status) to authenticated;

-- Corrected immutability trigger. Content is frozen unconditionally at every
-- status (not just once active) — every field below except contract_status
-- and the transition's own paired metadata columns must be byte-identical
-- to the row being replaced. Transition-specific metadata rules, not a
-- blanket exclusion: which columns may change depends on which exact
-- transition is occurring.
create or replace function authz.enforce_contract_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_content_changed boolean;
begin
  if current_setting('authority.allow_demo_purge', true) = 'on' then
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

  -- Transition-specific metadata: which columns the *lifecycle* side may set
  -- depends on exactly which edge is being taken, not merely "not content".
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
  -- draft->proposed and the active->{expired,revoked,superseded} edges have
  -- no Part 3A metadata columns to validate yet — no RPC or grant reaches
  -- them in this phase; Part 3B adds the relevant columns and rules
  -- alongside whichever RPC first makes each edge reachable.

  return new;
end;
$$;

revoke all on function authz.enforce_contract_immutable() from public, anon, authenticated;
