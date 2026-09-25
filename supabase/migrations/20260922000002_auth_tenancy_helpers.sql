-- Part 2A: authorization helper functions.
--
-- Why SECURITY DEFINER is used here, and only here:
--
-- The natural policy for `tenants` is "readable when I hold a membership",
-- which reads `tenant_memberships`. The natural policy for
-- `tenant_memberships` is "readable when I hold a membership in that tenant",
-- which also reads `tenant_memberships`. Expressed directly as policies, the
-- second is self-referential and Postgres aborts with infinite recursion.
--
-- These functions are owned by the migration role and marked SECURITY DEFINER,
-- so their body is not itself subject to `tenant_memberships` RLS. That breaks
-- the cycle. Containment rules applied to every one of them:
--
--   * `set search_path = ''` and fully-qualified object names, so no
--     user-created object can ever be resolved in their place.
--   * Arguments are typed (uuid / enum). No dynamic SQL, no string
--     interpolation, nothing user-supplied reaches an identifier position.
--   * Each reads only rows belonging to `auth.uid()`, so a caller learns
--     nothing about anyone else even though RLS is bypassed internally.
--   * EXECUTE is revoked from public and anon, then granted only to
--     `authenticated`.

-- Authority ordering. Kept as a function rather than relying on enum order so
-- the ordering is explicit and testable, and so adding a role later cannot
-- silently change who outranks whom.
create or replace function authz.role_rank(p_role public.tenant_role)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'viewer'         then 10
    when 'developer'      then 20
    when 'security_admin' then 30
    when 'admin'          then 40
    when 'owner'          then 50
  end;
$$;

-- The caller's role in one tenant, or null when they hold no membership.
create or replace function authz.current_role_in(p_tenant_id uuid)
returns public.tenant_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.tenant_memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = (select auth.uid());
$$;

create or replace function authz.is_member_of(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
  );
$$;

-- Tenant settings and membership administration both require admin or above.
create or replace function authz.can_manage_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select authz.role_rank(authz.current_role_in(p_tenant_id))
         >= authz.role_rank('admin');
$$;

-- The highest rank the caller is permitted to grant in this tenant.
--
-- Owner may grant owner. Admin is capped at admin: "admin cannot assign owner
-- unless explicitly permitted", and nothing here permits it. Everyone else
-- returns -1, which is below every real role, so no grant can satisfy it.
create or replace function authz.max_grantable_rank(p_tenant_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select case authz.current_role_in(p_tenant_id)
    when 'owner' then authz.role_rank('owner')
    when 'admin' then authz.role_rank('admin')
    else -1
  end;
$$;

-- May the caller act on a membership row carrying `p_target_role`?
--
-- Used for both the OLD row (may I touch this person at all?) and the NEW row
-- (may I grant this role?). Because an admin's ceiling is admin, an admin
-- cannot delete, demote or promote an owner.
create or replace function authz.can_administer_role(
  p_tenant_id   uuid,
  p_target_role public.tenant_role
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select authz.can_manage_tenant(p_tenant_id)
     and authz.role_rank(p_target_role) <= authz.max_grantable_rank(p_tenant_id);
$$;

-- Postgres grants EXECUTE to PUBLIC on new functions by default. Revoking is
-- not optional for SECURITY DEFINER code.
revoke all on function authz.role_rank(public.tenant_role) from public, anon;
revoke all on function authz.current_role_in(uuid) from public, anon;
revoke all on function authz.is_member_of(uuid) from public, anon;
revoke all on function authz.can_manage_tenant(uuid) from public, anon;
revoke all on function authz.max_grantable_rank(uuid) from public, anon;
revoke all on function authz.can_administer_role(uuid, public.tenant_role) from public, anon;

grant execute on function authz.role_rank(public.tenant_role) to authenticated;
grant execute on function authz.current_role_in(uuid) to authenticated;
grant execute on function authz.is_member_of(uuid) to authenticated;
grant execute on function authz.can_manage_tenant(uuid) to authenticated;
grant execute on function authz.max_grantable_rank(uuid) to authenticated;
grant execute on function authz.can_administer_role(uuid, public.tenant_role) to authenticated;
