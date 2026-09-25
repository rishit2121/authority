-- Part 2A: membership integrity guards.
--
-- RLS decides *who* may act. These triggers enforce invariants that must hold
-- regardless of who is acting — including the SECURITY DEFINER onboarding path
-- and any future server-side administration.

-- A membership row's identity is fixed. Re-pointing tenant_id or user_id on
-- UPDATE would let an otherwise-legitimate edit move a role across a tenant
-- boundary, sidestepping the per-tenant checks in the UPDATE policy (which
-- evaluates the caller's rights against each row's own tenant).
create or replace function authz.enforce_membership_identity_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id <> old.tenant_id then
    raise exception 'tenant_id of a membership is immutable'
      using errcode = '23514';
  end if;

  if new.user_id <> old.user_id then
    raise exception 'user_id of a membership is immutable'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- A tenant must never be left without an owner: an ownerless tenant would be
-- unadministrable, since every membership-management path requires admin or
-- above and only an owner can grant owner.
--
-- This is a BEFORE trigger, so the departing row is still present in the
-- count; "1 remaining" therefore means "this is the last owner".
create or replace function authz.enforce_owner_survives()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id    uuid;
  v_owner_count  integer;
  v_losing_owner boolean;
begin
  v_tenant_id := old.tenant_id;

  v_losing_owner := case tg_op
    when 'DELETE' then old.role = 'owner'
    when 'UPDATE' then old.role = 'owner' and new.role <> 'owner'
    else false
  end;

  if not v_losing_owner then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  select pg_catalog.count(*)
  into v_owner_count
  from public.tenant_memberships m
  where m.tenant_id = v_tenant_id
    and m.role = 'owner';

  if v_owner_count <= 1 then
    raise exception 'tenant must retain at least one owner'
      using errcode = '23514';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

revoke all on function authz.enforce_membership_identity_immutable()
  from public, anon, authenticated;
revoke all on function authz.enforce_owner_survives()
  from public, anon, authenticated;

create trigger tenant_memberships_identity_immutable
  before update on public.tenant_memberships
  for each row execute function authz.enforce_membership_identity_immutable();

create trigger tenant_memberships_owner_survives
  before update or delete on public.tenant_memberships
  for each row execute function authz.enforce_owner_survives();
