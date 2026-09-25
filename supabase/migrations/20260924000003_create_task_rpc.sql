-- Part 2B.2: task creation.
--
-- Part 3 will generate Task Authority Contracts from a task's trusted
-- objective; Part 2B.2 needs real tasks to exist first, without performing
-- any of that work itself. This migration adds exactly what's needed for
-- that and nothing more.
--
-- Pre-contract status: the existing task_status enum already orders
-- 'pending' before 'contract_issued' — 'pending' *is* "created, no
-- contract yet". No enum change is needed; create_task() below simply uses
-- the state the schema already provides for this.

alter table public.tasks
  add column idempotency_key text;

create unique index tasks_tenant_idempotency_key_idx
  on public.tasks (tenant_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.tasks.idempotency_key is
  'Optional caller-supplied key for create_task(). A retried submission with '
  'the same key returns the original task rather than creating a second one.';

-- create_task(): the narrow, fixed-purpose task-creation RPC.
--
-- Performs no model call and no external tool call, issues no Task
-- Authority Contract, and creates no authorization decision or capability —
-- exactly a row in `tasks`, nothing else. Deliberately not a generic insert
-- endpoint: the signature is fixed, every argument is validated, and the
-- only state the caller controls is the objective text and which of their
-- own tenant's agent/principal the task is attributed to.
create or replace function public.create_task(
  p_tenant_id uuid,
  p_agent_id uuid,
  p_principal_id uuid,
  p_trusted_objective text,
  p_provenance text default 'app_form',
  p_idempotency_key text default null
)
returns table (task_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_id uuid;
  v_new_id uuid;
  v_objective text;
begin
  -- Caller identity is derived from auth.uid() transitively through
  -- has_min_role()/current_role_in() — never from an argument. p_tenant_id
  -- is checked, not trusted: this is the same pattern as
  -- install_demo_workspace() and terminate_task().
  if not authz.has_min_role(p_tenant_id, 'developer') then
    raise exception 'insufficient privileges to create a task in this tenant'
      using errcode = '42501';
  end if;

  v_objective := btrim(p_trusted_objective);
  if v_objective is null or char_length(v_objective) < 1 then
    raise exception 'trusted objective must not be empty' using errcode = '22023';
  end if;
  if char_length(v_objective) > 4000 then
    raise exception 'trusted objective exceeds the maximum length' using errcode = '22023';
  end if;

  -- Idempotency: a retried submission with the same key returns the
  -- original task rather than creating a second one. Checked before the
  -- membership checks below run again, so a retry after a transient error
  -- costs one extra lookup rather than repeating the full validation path
  -- unnecessarily — though it would produce the same result either way.
  if p_idempotency_key is not null then
    select id into v_existing_id
    from public.tasks
    where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;

    if v_existing_id is not null then
      return query select v_existing_id, false;
      return;
    end if;
  end if;

  -- Explicit, friendly pre-checks. The composite foreign keys on `tasks`
  -- would reject a cross-tenant agent_id or principal_id regardless (see
  -- 20260923000002_principals_agents_tasks.sql) — this is a clearer error
  -- message ahead of that backstop, not a replacement for it.
  if not exists (
    select 1 from public.agents where id = p_agent_id and tenant_id = p_tenant_id
  ) then
    raise exception 'agent does not belong to the target tenant' using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.principals where id = p_principal_id and tenant_id = p_tenant_id
  ) then
    raise exception 'principal does not belong to the target tenant' using errcode = '23503';
  end if;

  insert into public.tasks (
    tenant_id, agent_id, principal_id, intent, status,
    initiating_user_id, trusted_context_provenance, idempotency_key
  )
  values (
    p_tenant_id, p_agent_id, p_principal_id, v_objective, 'pending',
    (select auth.uid()),
    jsonb_build_object('schemaVersion', 1, 'source', coalesce(p_provenance, 'app_form')),
    p_idempotency_key
  )
  returning id into v_new_id;

  return query select v_new_id, true;
end;
$$;

revoke all on function public.create_task(uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.create_task(uuid, uuid, uuid, text, text, text) to authenticated;
