-- Part 2B.1: append-only and immutability enforcement.
--
-- The Part 2B.1 RLS migration already makes it impossible for any
-- authenticated client to UPDATE or DELETE authorization_decisions or
-- execution_events, because `authenticated` holds no such privilege on
-- either table. This migration adds a second, independent layer: a trigger
-- that unconditionally rejects UPDATE and DELETE on both tables regardless
-- of role — including the `postgres` role the SECURITY DEFINER RPCs in the
-- next migration run as. Triggers fire for every role; BYPASSRLS skips row
-- security policies, not triggers. This means append-only is enforced by the
-- database itself, not by a convention future code has to keep honouring.
--
-- One narrow, transaction-scoped escape hatch exists: reset_demo_workspace()
-- (next migration) sets `authority.allow_demo_purge = 'on'` with `SET LOCAL`
-- before it deletes anything, so the setting reverts automatically at the end
-- of that function's transaction and cannot leak into any other session. The
-- three trigger functions below check it and otherwise raise. This does not
-- weaken the append-only guarantee for real data: reset_demo_workspace's own
-- DELETEs are additionally scoped to `demo_key is not null`, so even with the
-- escape hatch active, a real (non-demo) row is structurally unreachable by
-- it — two independent reasons, not one, that audit data can never be purged
-- this way.

create or replace function authz.forbid_update_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('authority.allow_demo_purge', true) = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  raise exception 'rows in % are append-only and cannot be updated or deleted', tg_table_name
    using errcode = '23514';
end;
$$;

revoke all on function authz.forbid_update_delete() from public, anon, authenticated;

create trigger authorization_decisions_append_only
  before update or delete on public.authorization_decisions
  for each row execute function authz.forbid_update_delete();

create trigger execution_events_append_only
  before update or delete on public.execution_events
  for each row execute function authz.forbid_update_delete();

-- Contracts and activated policy versions are immutable, not append-only —
-- INSERT of a new version is how they change. Blocks the old row's UPDATE or
-- DELETE once activated; a fresh row with a bumped version is the only way
-- forward. Unlike the trigger above, this only blocks a row once it reaches
-- 'active', so the demo installer (or a future draft-editing flow) can still
-- write a contract in one INSERT and never touch it again.

create or replace function authz.enforce_contract_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('authority.allow_demo_purge', true) = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if old.contract_status = 'active' then
    raise exception 'an active task authority contract is immutable; create a new version instead'
      using errcode = '23514';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

revoke all on function authz.enforce_contract_immutable() from public, anon, authenticated;

create trigger contracts_immutable_once_active
  before update or delete on public.task_authority_contracts
  for each row execute function authz.enforce_contract_immutable();

create or replace function authz.enforce_policy_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('authority.allow_demo_purge', true) = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if old.status = 'active' then
    raise exception 'an active policy version is immutable; create a new version instead'
      using errcode = '23514';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

revoke all on function authz.enforce_policy_immutable() from public, anon, authenticated;

create trigger policies_immutable_once_active
  before update or delete on public.policies
  for each row execute function authz.enforce_policy_immutable();
