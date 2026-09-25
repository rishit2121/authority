-- Part 3A: create_candidate_plan() — the only write path for candidate plans.
--
-- `plans`/`plan_nodes` grant zero INSERT/UPDATE/DELETE privilege to
-- `authenticated` (unchanged by this migration — still SELECT-only, verified
-- live). This SECURITY DEFINER function is the sole way a candidate plan
-- version is ever created.
--
-- Validations split explicitly between TypeScript (before this call) and
-- PostgreSQL (independently, here):
--
--   TypeScript (lib/authorization/plan-validator.ts, already run before the
--   server action calls this RPC): operation exists in the registry,
--   argument schema, per-node findings (accepted/requires_review/clarify/
--   replan/denied), external-communication escalation, policy evaluation.
--   None of that is re-derived here — the registry is code, not a database
--   table, and this function has no access to it.
--
--   PostgreSQL (this function, independent of whatever the caller claims):
--   caller identity via auth.uid() (NULL denied, never silently proceeds),
--   tenant membership and role re-resolved from the task's own row (never
--   trusted from an argument), bounded node count, duplicate node-key
--   rejection (a real unique constraint, not just an application check),
--   every dependency/data-flow reference points to a node in the *same*
--   submitted array with a strictly smaller `sequence` (the concrete
--   meaning of "the database independently checks a server-submitted
--   topological order" — proving every reference points strictly backward
--   is suffient to prove acyclicity without the database running graph
--   traversal), every data-flow reference's named output was actually
--   declared by its source node, and idempotency identity.
--
-- Never creates a contract or any authority. Never mutates an existing plan
-- row — every call is a fresh INSERT of a new (task_id, version) pair,
-- honoring the append-only design plans/plan_nodes now have.

create or replace function public.create_candidate_plan(
  p_task_id uuid,
  p_nodes jsonb,
  p_input_hash text,
  p_idempotency_key text default null
)
returns table (plan_id uuid, version integer, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_node_count integer;
  v_existing_plan_id uuid;
  v_existing_version integer;
  v_existing_input_hash text;
  v_new_plan_id uuid;
  v_new_version integer;
  v_bad_ref record;
begin
  if (select auth.uid()) is null then
    raise exception 'create_candidate_plan() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.tasks where id = p_task_id;
  if v_tenant_id is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  if not authz.has_min_role(v_tenant_id, 'developer') then
    raise exception 'insufficient privileges to create a candidate plan for this task' using errcode = '42501';
  end if;

  if p_input_hash is null or p_input_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'input_hash must be 64 lowercase hex characters' using errcode = '22023';
  end if;

  if p_idempotency_key is not null and char_length(p_idempotency_key) > 200 then
    raise exception 'idempotency key exceeds maximum length' using errcode = '22023';
  end if;

  v_node_count := jsonb_array_length(p_nodes);
  if v_node_count is null or v_node_count < 1 or v_node_count > 50 then
    raise exception 'candidate plan must have between 1 and 50 nodes' using errcode = '22023';
  end if;

  -- Serializes concurrent submissions for this task so version allocation
  -- and the idempotency check below cannot race. Held for the rest of this
  -- transaction; released automatically on commit or rollback.
  perform pg_advisory_xact_lock(hashtextextended('authority.candidate_plan_version:' || p_task_id::text, 0));

  if p_idempotency_key is not null then
    select p.id, p.version, p.input_hash
      into v_existing_plan_id, v_existing_version, v_existing_input_hash
    from public.plans p
    where p.task_id = p_task_id and p.idempotency_key = p_idempotency_key;

    if v_existing_plan_id is not null then
      if v_existing_input_hash = p_input_hash then
        return query select v_existing_plan_id, v_existing_version, false;
        return;
      end if;
      raise exception 'idempotency key % was already used for this task with different content', p_idempotency_key
        using errcode = '23505';
    end if;
  end if;

  select coalesce(max(p.version), 0) + 1 into v_new_version from public.plans p where p.task_id = p_task_id;

  insert into public.plans (tenant_id, task_id, version, idempotency_key, input_hash)
  values (v_tenant_id, p_task_id, v_new_version, p_idempotency_key, p_input_hash)
  returning id into v_new_plan_id;

  insert into public.plan_nodes (
    tenant_id, plan_id, node_key, sequence_no, tool, operation, resource,
    normalized_arguments, dependencies, declared_outputs, data_flow_refs,
    max_invocations, validation_status
  )
  select
    v_tenant_id,
    v_new_plan_id,
    elem ->> 'id',
    (elem ->> 'sequence')::integer,
    elem ->> 'tool',
    split_part(elem ->> 'tool', '.', 2),
    elem ->> 'resource_binding',
    jsonb_build_object('schemaVersion', 1, 'values', coalesce(elem -> 'arguments', '{}'::jsonb)),
    coalesce((select array_agg(x) from jsonb_array_elements_text(elem -> 'dependencies') as x), '{}'::text[]),
    jsonb_build_object('schemaVersion', 1, 'outputs', coalesce(elem -> 'declared_outputs', '[]'::jsonb)),
    jsonb_build_object('schemaVersion', 1, 'refs', coalesce(elem -> 'data_flow_refs', '[]'::jsonb)),
    (elem ->> 'max_invocations')::integer,
    (elem ->> 'validation_status')::public.plan_node_validation_status
  from jsonb_array_elements(p_nodes) as elem;

  -- Independent re-verification: every dependency must reference a node
  -- present in this same plan with a strictly smaller sequence_no. Written
  -- as NOT EXISTS rather than a LEFT JOIN, since a JOIN's ON clause cannot
  -- reference a sibling comma-joined/lateral source (n) from outside that
  -- specific join pair.
  select n.node_key, dep as bad_dependency
    into v_bad_ref
  from public.plan_nodes n
  cross join lateral unnest(n.dependencies) as dep
  where n.plan_id = v_new_plan_id
    and not exists (
      select 1 from public.plan_nodes d
      where d.plan_id = n.plan_id and d.node_key = dep and d.sequence_no < n.sequence_no
    )
  limit 1;

  if v_bad_ref is not null then
    raise exception 'node % has an invalid dependency reference to %: not present in this plan or not strictly earlier',
      v_bad_ref.node_key, v_bad_ref.bad_dependency
      using errcode = '23514';
  end if;

  -- Independent re-verification: every data-flow reference must point to a
  -- node in this same plan, with a strictly smaller sequence_no, that
  -- actually declared the named output.
  select n.node_key
    into v_bad_ref
  from public.plan_nodes n
  cross join lateral jsonb_array_elements(n.data_flow_refs -> 'refs') as ref
  where n.plan_id = v_new_plan_id
    and not exists (
      select 1 from public.plan_nodes src
      where src.plan_id = n.plan_id
        and src.node_key = (ref ->> 'fromNodeId')
        and src.sequence_no < n.sequence_no
        and (src.declared_outputs -> 'outputs') ? (ref ->> 'output')
    )
  limit 1;

  if v_bad_ref is not null then
    raise exception 'node % has an invalid data-flow reference', v_bad_ref.node_key
      using errcode = '23514';
  end if;

  return query select v_new_plan_id, v_new_version, true;
end;
$fn$;

revoke all on function public.create_candidate_plan(uuid, jsonb, text, text) from public, anon;
grant execute on function public.create_candidate_plan(uuid, jsonb, text, text) to authenticated;
