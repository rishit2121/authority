-- Part 3B: widen the existing approvals table to also carry contract-
-- activation approval requirements, alongside its original decision-bound
-- shape (the runtime tool-call exception gate, unchanged, still supported).
--
-- A contract-bound approval binds to the exact immutable contract id,
-- version, plan id, input/output hash, registry version and compiler
-- version — all copied from the task_authority_contracts row itself inside
-- submit_contract_for_approval() (next migration), never accepted as
-- caller-supplied arguments. Approving one contract version can never be
-- mistaken for approving a later recompilation: a new version is a new
-- contract_id, so its approval rows start over at zero, regardless of how
-- an earlier version's identical-looking requirement was resolved.

create type public.approval_requirement_kind as enum ('task_owner', 'role');

alter table public.approvals
  alter column authorization_decision_id drop not null,
  alter column requested_from_principal_id drop not null,
  add column contract_id uuid,
  add column contract_version integer,
  add column plan_id uuid,
  add column input_hash text,
  add column output_hash text,
  add column registry_version text,
  add column compiler_version text,
  add column required_kind public.approval_requirement_kind,
  add column required_role public.tenant_role,
  -- One row per required slot, not one row per requirement tier: a
  -- requirement needing N distinct approvals becomes N rows sharing the
  -- same (contract_id, required_kind, required_role) and distinct
  -- slot_index 0..N-1, each independently satisfiable — a single approval
  -- row can only ever record one principal's decision, so "2 required"
  -- cannot be expressed as one row that somehow needs two responses.
  add column slot_index integer,
  add column self_approval_allowed boolean not null default false;

alter table public.approvals
  add constraint approvals_exactly_one_binding
    check ((authorization_decision_id is not null)::int + (contract_id is not null)::int = 1),
  add constraint approvals_contract_binding_complete
    check (
      contract_id is null
      or (
        contract_version is not null and plan_id is not null and input_hash is not null
        and output_hash is not null and registry_version is not null and compiler_version is not null
        and required_kind is not null and slot_index is not null
      )
    ),
  add constraint approvals_decision_binding_has_no_contract_fields
    check (
      contract_id is not null
      or (
        contract_version is null and plan_id is null and input_hash is null and output_hash is null
        and registry_version is null and compiler_version is null and required_kind is null
        and required_role is null and slot_index is null
      )
    ),
  add constraint approvals_role_kind_needs_role
    check (required_kind is distinct from 'role' or required_role is not null),
  add constraint approvals_task_owner_kind_has_no_role
    check (required_kind is distinct from 'task_owner' or required_role is null),
  add constraint approvals_slot_index_nonnegative
    check (slot_index is null or slot_index >= 0),
  add constraint approvals_input_hash_format
    check (input_hash is null or input_hash ~ '^[0-9a-f]{64}$'),
  add constraint approvals_output_hash_format
    check (output_hash is null or output_hash ~ '^[0-9a-f]{64}$'),
  add constraint approvals_contract_fk
    foreign key (contract_id, tenant_id) references public.task_authority_contracts (id, tenant_id),
  add constraint approvals_plan_fk
    foreign key (plan_id, tenant_id) references public.plans (id, tenant_id);

-- One row per (contract, requirement tier, slot) — request creation
-- generates exactly `count` rows per tier and relies on this to safely
-- no-op on a retried call rather than duplicating rows.
create unique index approvals_one_per_contract_requirement_slot
  on public.approvals (contract_id, required_kind, coalesce(required_role::text, ''), slot_index)
  where contract_id is not null;

-- Security-critical tightening, not merely additive: the existing
-- "approvals_update_by_security_admin_and_above" policy (Part 2B.1) lets
-- any security_admin+ member UPDATE any approvals row directly, including
-- one that will exist for contract-bound rows once this migration lands.
-- decide_contract_approval() (next migration) enforces the *real* rules —
-- matching required_kind/required_role, self-approval prevention, distinct-
-- approver-per-tier, "must currently be pending" — entirely in PL/pgSQL;
-- none of that is expressible in an RLS USING/WITH CHECK clause. Left as-is,
-- the existing policy would let a client bypass every one of those checks
-- with a raw PostgREST UPDATE. Narrowed here to decision-bound rows only; a
-- contract-bound row can only ever be mutated by the SECURITY DEFINER RPC,
-- which runs as the table owner and is therefore unaffected by this policy
-- either way.
drop policy "approvals_update_by_security_admin_and_above" on public.approvals;
create policy "approvals_update_decision_bound_by_security_admin_and_above"
  on public.approvals for update to authenticated
  using (authz.has_min_role(tenant_id, 'security_admin') and contract_id is null)
  with check (authz.has_min_role(tenant_id, 'security_admin') and contract_id is null);
