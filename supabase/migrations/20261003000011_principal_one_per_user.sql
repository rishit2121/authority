-- Fixes a latent correctness/security gap found while investigating pgTAP
-- flakiness in 06_demo_data_lifecycle.sql, 16_contract_activation_and_approvals.sql
-- and 19_gateway_enforcement.sql: nothing has ever enforced that a real
-- person has at most one `principals` row per tenant. gateway.actor_principal
-- (20260930000010) lazily creates one on first real use, and several
-- functions -- most importantly public.decide_contract_approval -- resolve
-- "the caller's own principal" with a bare
--   select id into v_x from principals where tenant_id = ? and user_id = ?
-- with no ORDER BY/LIMIT. With exactly one matching row this is fine; with
-- two, plain `select ... into` (not `... into strict`) silently keeps
-- whichever row the planner happens to return first -- genuinely
-- undefined, not merely unspecified, and observed to flip between runs.
--
-- This is not just a test-fixture annoyance: decide_contract_approval's
-- self-approval and distinct-approver checks compare principal ids as a
-- stand-in for "is this the same real person" (task_owner match,
-- "submitter may not also approve", "the same principal cannot fill two
-- slots of one tier"). That comparison is only trustworthy if one person
-- cannot hold two principal rows in the same tenant -- otherwise a
-- sufficiently-coordinated pair of principal rows for the same human could
-- defeat any of those three checks. This migration makes that invariant
-- real at the database level, for every row linked to a real account, not
-- just the ones pgTAP happens to exercise.
--
-- Demo/validation-seed principals (install_demo_workspace, the validation
-- lab's scenario seeding) are unaffected: every one of them is created with
-- user_id left null by design (see principals.user_id's own column
-- comment), so the partial index below never applies to them.

create unique index principals_tenant_user_id_unique
  on public.principals (tenant_id, user_id)
  where user_id is not null;

-- gateway.actor_principal must now handle the race it always had in theory
-- (two concurrent first-uses both observing "not found" and both inserting)
-- as a real constraint violation rather than a harmless duplicate: lose the
-- race gracefully and read back the winner's row, the same
-- insert-then-reread-on-conflict shape already used elsewhere in this
-- schema (e.g. gateway.bind_task_connector).
create or replace function gateway.actor_principal(p_tenant_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_name text;
begin
  if not exists (select 1 from public.tenant_memberships m where m.tenant_id = p_tenant_id and m.user_id = p_user_id) then
    return null;
  end if;
  select p.id into v_id from public.principals p
  where p.tenant_id = p_tenant_id and p.user_id = p_user_id order by p.created_at, p.id limit 1;
  if v_id is not null then return v_id; end if;

  select coalesce(nullif(btrim(pr.display_name), ''), nullif(split_part(u.email, '@', 1), ''), 'Member')
    into v_name
  from auth.users u left join public.profiles pr on pr.user_id = u.id where u.id = p_user_id;

  insert into public.principals (tenant_id, kind, display_name, email, user_id)
  select p_tenant_id, 'human', left(coalesce(v_name, 'Member'), 200), u.email, p_user_id
  from auth.users u where u.id = p_user_id
  on conflict (tenant_id, user_id) where user_id is not null do nothing
  returning id into v_id;
  if v_id is not null then return v_id; end if;

  -- Lost a concurrent race to create one; the winner's row is the real answer.
  select p.id into v_id from public.principals p
  where p.tenant_id = p_tenant_id and p.user_id = p_user_id order by p.created_at, p.id limit 1;
  return v_id;
end;
$fn$;
revoke all on function gateway.actor_principal(uuid, uuid) from public;
grant execute on function gateway.actor_principal(uuid, uuid) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000011'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
