-- ROLLBACK of migration 20261028000001 (agent-generated arguments) to schema 20261027000001.
--
-- Not a migration. Run it only to return the database to 20261027000001, in one transaction:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/rollback/20261028_rollback_to_20261027000001.sql
-- Restores gateway.create_candidate_plan_core verbatim (20261003000014). The plan_nodes.agent_generated column and
-- its check function are kept: with their default they change nothing for the previous code, and plans that used
-- them keep their record. Removes the migration from the Supabase history so a later `db push` re-applies it.

create or replace function gateway.create_candidate_plan_core(
  p_tenant_id uuid, p_task_id uuid, p_nodes jsonb, p_input_hash text, p_idempotency_key text
)
returns table (plan_id uuid, version integer, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_node_count integer;
  v_existing_plan_id uuid;
  v_existing_version integer;
  v_existing_input_hash text;
  v_new_plan_id uuid;
  v_new_version integer;
  v_bad_ref record;
begin
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
  values (p_tenant_id, p_task_id, v_new_version, p_idempotency_key, p_input_hash)
  returning id into v_new_plan_id;

  insert into public.plan_nodes (
    tenant_id, plan_id, node_key, sequence_no, tool, operation, resource,
    normalized_arguments, dependencies, declared_outputs, data_flow_refs,
    max_invocations, validation_status, expected_effect
  )
  select
    p_tenant_id,
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
    (elem ->> 'validation_status')::public.plan_node_validation_status,
    elem ->> 'expected_effect'
  from jsonb_array_elements(p_nodes) as elem;

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
revoke all on function gateway.create_candidate_plan_core(uuid, uuid, jsonb, text, text) from public;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261027000001'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;

delete from supabase_migrations.schema_migrations where version = '20261028000001';
