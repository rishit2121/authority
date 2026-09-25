-- Part 2A: row level security.
--
-- Every table created in Part 2A has RLS enabled and carries explicit,
-- narrowly-scoped policies. There is no `using (true)` anywhere in this file.
--
-- A note on FORCE ROW LEVEL SECURITY: it is deliberately *not* used. The
-- recursion-breaking helpers in the previous migration depend on the table
-- owner being exempt from RLS when their bodies run. Forcing RLS would apply
-- policies to the owner too, re-introducing the recursion the helpers exist to
-- prevent. Containment is instead provided by those functions being narrow,
-- argument-typed, search_path-pinned, and execute-revoked from anon/public.
--
-- Every policy is scoped `to authenticated`. Combined with anon holding no
-- table privileges at all, unauthenticated access is denied twice over.

alter table public.profiles            enable row level security;
alter table public.tenants             enable row level security;
alter table public.tenant_memberships  enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: a user may read and update only their own row.
-- ---------------------------------------------------------------------------

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Onboarding runs as SECURITY DEFINER and does not need this, but a user
-- creating their own profile directly is harmless and keeps the table usable.
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No DELETE policy: profiles disappear only with the auth.users row, via the
-- ON DELETE CASCADE on the primary key.

-- ---------------------------------------------------------------------------
-- tenants: readable only where the caller holds a membership; settings
-- writable only by admin and above.
-- ---------------------------------------------------------------------------

create policy "tenants_select_where_member"
  on public.tenants
  for select
  to authenticated
  using (authz.is_member_of(id));

create policy "tenants_update_by_managers"
  on public.tenants
  for update
  to authenticated
  using (authz.can_manage_tenant(id))
  -- Re-checked on the new row so an admin cannot move a tenant somewhere they
  -- would no longer be permitted to manage it.
  with check (authz.can_manage_tenant(id));

-- No INSERT policy and no INSERT grant: in Part 2A a tenant is created only by
-- public.ensure_onboarded(), which sets created_by itself. No DELETE policy:
-- deleting an organization is not a Part 2A capability.

-- ---------------------------------------------------------------------------
-- tenant_memberships: the escalation-sensitive table.
-- ---------------------------------------------------------------------------

-- Readable for tenants the caller can access. Uses the SECURITY DEFINER helper
-- against this same table, which is what keeps the policy non-recursive.
create policy "memberships_select_within_accessible_tenants"
  on public.tenant_memberships
  for select
  to authenticated
  using (authz.is_member_of(tenant_id));

-- `user_id <> auth.uid()` is the self-escalation block: a developer cannot
-- insert a second row promoting themselves, because they may not write their
-- own membership row at all. can_administer_role caps the granted role at the
-- caller's own ceiling.
create policy "memberships_insert_by_administrators"
  on public.tenant_memberships
  for insert
  to authenticated
  with check (
    user_id <> (select auth.uid())
    and authz.can_administer_role(tenant_id, role)
  );

-- USING sees the OLD row, WITH CHECK sees the NEW row. Both are required:
-- USING answers "may I touch this member?" (so an admin cannot demote an
-- owner) and WITH CHECK answers "may I grant this role?" (so an admin cannot
-- promote anyone to owner).
create policy "memberships_update_by_administrators"
  on public.tenant_memberships
  for update
  to authenticated
  using (
    user_id <> (select auth.uid())
    and authz.can_administer_role(tenant_id, role)
  )
  with check (
    user_id <> (select auth.uid())
    and authz.can_administer_role(tenant_id, role)
  );

create policy "memberships_delete_by_administrators"
  on public.tenant_memberships
  for delete
  to authenticated
  using (
    user_id <> (select auth.uid())
    and authz.can_administer_role(tenant_id, role)
  );
