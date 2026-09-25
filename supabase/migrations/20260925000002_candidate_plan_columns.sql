-- Part 3A: candidate-plan columns, append-only enforcement, idempotency.
--
-- Legacy-row preflight (queried live before drafting this migration, not
-- assumed): plans total=4, all demo_key IS NOT NULL, all status='proposed';
-- plan_nodes total=24, all demo_key IS NOT NULL. Zero non-demo legacy rows
-- exist, so every status-conditioned check below (`demo_key is not null or
-- <new column> is not null`) is satisfied by every existing row today, and
-- a future non-demo row is exactly the case the check is meant to require.
-- `demo_key` cannot be used as a bypass going forward: no RPC in this phase
-- accepts a demo_key parameter, and it is never set from browser input —
-- confirmed by inspection of create_candidate_plan below, the only writer.
--
-- `plan_node_status` (proposed/allowed/rejected/executed/skipped) already
-- means *runtime execution state*, set once a node's corresponding request
-- has actually been evaluated at execution time. The plan validator's
-- structural-validation findings (accepted/requires_review/clarify/replan/
-- denied) are a different, strictly earlier concept — mixing them onto one
-- column would blur exactly the trust boundary this phase exists to
-- preserve (validation happens on the untrusted candidate plan before any
-- contract or capability exists). `validation_status` is therefore a new,
-- separate column; `status` is untouched.

create type public.plan_node_validation_status as enum (
  'pending', 'accepted', 'requires_review', 'clarify', 'replan', 'denied'
);

-- `dependencies uuid[]` has never held a value in any row (verified live:
-- zero non-empty arrays across every existing plan_nodes row) — it was
-- always the wrong type for what a candidate node's dependency actually is:
-- a caller-assigned stable string id (`node_key`), not a database uuid,
-- since a candidate plan's nodes don't have real row ids until they're
-- inserted together in one statement. Retyped rather than left to rot.
alter table public.plan_nodes
  alter column dependencies type text[] using dependencies::text[];

alter table public.plan_nodes
  add column declared_outputs jsonb,
  add column data_flow_refs jsonb,
  add column max_invocations integer,
  add column validation_status public.plan_node_validation_status;

alter table public.plan_nodes
  add constraint plan_nodes_declared_outputs_versioned
    check (demo_key is not null or (declared_outputs is not null and authz.has_allowed_schema_version(declared_outputs, array[1]))),
  add constraint plan_nodes_data_flow_refs_versioned
    check (demo_key is not null or (data_flow_refs is not null and authz.has_allowed_schema_version(data_flow_refs, array[1]))),
  add constraint plan_nodes_max_invocations_required
    check (demo_key is not null or max_invocations is not null),
  add constraint plan_nodes_max_invocations_bounded
    check (max_invocations is null or (max_invocations > 0 and max_invocations <= 20)),
  add constraint plan_nodes_dependencies_bounded
    check (dependencies is null or array_length(dependencies, 1) <= 20),
  add constraint plan_nodes_declared_outputs_bounded
    check (declared_outputs is null or pg_column_size(declared_outputs) <= 4096),
  add constraint plan_nodes_data_flow_refs_bounded
    check (data_flow_refs is null or pg_column_size(data_flow_refs) <= 8192);

-- "Stable node ID, unique within its plan" — the actual guarantee behind
-- "reject duplicate node IDs", independent of whatever the calling
-- TypeScript layer already checked.
alter table public.plan_nodes
  add constraint plan_nodes_plan_id_node_key_unique unique (plan_id, node_key);

-- Idempotency identity for create_candidate_plan(): (task_id, idempotency_key)
-- when a key is supplied at all. input_hash is computed by the caller using
-- the same canonicalization the rest of Part 3A uses (see
-- lib/authorization/canonicalize.ts) and is never recomputed in SQL — the
-- database's job is comparing two opaque hash strings for the idempotency
-- rule, not re-deriving JCS canonicalization itself.
alter table public.plans
  add column idempotency_key text,
  add column input_hash text;

alter table public.plans
  add constraint plans_input_hash_format
    check (demo_key is not null or (input_hash is not null and input_hash ~ '^[0-9a-f]{64}$')),
  add constraint plans_idempotency_key_bounded
    check (idempotency_key is null or char_length(idempotency_key) <= 200);

create unique index plans_tenant_task_idempotency_key_idx
  on public.plans (task_id, idempotency_key)
  where idempotency_key is not null;

-- Append-only, reusing the existing generic trigger function rather than
-- duplicating it: candidate plans and their nodes are never updated in
-- place — every edit is a fresh (task_id, version) row. `authenticated`
-- already holds zero write grant on either table (unchanged by this
-- migration), so this is defense-in-depth against a future RPC bug, the
-- same posture the original append-only tables already have.
create trigger plans_append_only
  before update or delete on public.plans
  for each row execute function authz.forbid_update_delete();

create trigger plan_nodes_append_only
  before update or delete on public.plan_nodes
  for each row execute function authz.forbid_update_delete();
