-- Role escalation and membership administration.
--
-- Every assertion here is an attempt to acquire authority the actor should not
-- have. RLS makes a forbidden UPDATE/DELETE match zero rows rather than raise,
-- and a forbidden INSERT raise 42501, so both shapes are checked.

select plan(17);

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Viewer (Vera). Lowest role in tenant A.
-- ---------------------------------------------------------------------------

set local request.jwt.claims =
  '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}';

select t(
  is(
    (select authz.can_manage_tenant('11111111-1111-4111-8111-111111111111')),
    false,
    'viewer: cannot manage tenant settings'
  )
);

update public.tenants
  set name = 'Viewer was here', environment = 'production'
  where id = '11111111-1111-4111-8111-111111111111';

select t(
  is(
    (select count(*) from public.tenants
      where id = '11111111-1111-4111-8111-111111111111'
        and name = 'Northwind Labs'
        and environment = 'development')::int,
    1,
    'viewer: attempt to modify tenant settings changed nothing'
  )
);

-- ---------------------------------------------------------------------------
-- Developer (Devi). Must not be able to promote anyone, least of all self.
-- ---------------------------------------------------------------------------

set local request.jwt.claims =
  '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';

update public.tenant_memberships
  set role = 'owner'
  where tenant_id = '11111111-1111-4111-8111-111111111111'
    and user_id = 'a0000000-0000-4000-8000-000000000003';

select t(
  is(
    (select role::text from public.tenant_memberships
      where tenant_id = '11111111-1111-4111-8111-111111111111'
        and user_id = 'a0000000-0000-4000-8000-000000000003'),
    'developer',
    'developer: cannot promote themselves to owner'
  )
);

-- The subtler variant: a second membership row rather than an edit of their own.
select t(
  throws_ok(
    $$ insert into public.tenant_memberships (tenant_id, user_id, role)
       values ('11111111-1111-4111-8111-111111111111',
               'a0000000-0000-4000-8000-000000000003', 'admin') $$,
    '42501',
    null,
    'developer: cannot insert a second, higher membership for themselves'
  )
);

select t(
  throws_ok(
    $$ insert into public.tenant_memberships (tenant_id, user_id, role)
       values ('22222222-2222-4222-8222-222222222222',
               'a0000000-0000-4000-8000-000000000003', 'viewer') $$,
    '42501',
    null,
    'developer: cannot grant themselves access to another tenant'
  )
);

select t(
  is(
    (select authz.max_grantable_rank('11111111-1111-4111-8111-111111111111')),
    -1,
    'developer: may grant no role at all'
  )
);

-- ---------------------------------------------------------------------------
-- Admin (Amin). May administer, but is capped below owner.
-- ---------------------------------------------------------------------------

set local request.jwt.claims =
  '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';

select t(
  is(
    (select authz.max_grantable_rank('11111111-1111-4111-8111-111111111111')),
    (select authz.role_rank('admin')),
    'admin: grant ceiling is admin, not owner'
  )
);

select t(
  is(
    (select authz.can_administer_role(
       '11111111-1111-4111-8111-111111111111', 'owner')),
    false,
    'admin: cannot administer an owner-role row'
  )
);

-- Promoting the viewer to owner is the escalation-by-proxy path: an admin who
-- could mint an owner could have that owner promote them back.
--
-- This one raises rather than matching zero rows, and the distinction is worth
-- stating: USING admits the row, because an admin may legitimately administer
-- a viewer, but WITH CHECK rejects the owner role on the new row. A row the
-- actor may touch, changed into one they may not create, is an explicit
-- violation rather than an invisible no-op.
select t(
  throws_ok(
    $$ update public.tenant_memberships set role = 'owner'
       where tenant_id = '11111111-1111-4111-8111-111111111111'
         and user_id = 'a0000000-0000-4000-8000-000000000004' $$,
    '42501',
    null,
    'admin: cannot assign the owner role to another member'
  )
);

select t(
  is(
    (select role::text from public.tenant_memberships
      where tenant_id = '11111111-1111-4111-8111-111111111111'
        and user_id = 'a0000000-0000-4000-8000-000000000004'),
    'viewer',
    'admin: the rejected owner grant left the viewer untouched'
  )
);

-- Nor may an admin remove an owner to clear the way.
delete from public.tenant_memberships
  where tenant_id = '11111111-1111-4111-8111-111111111111'
    and user_id = 'a0000000-0000-4000-8000-000000000001';

select t(
  is(
    (select count(*) from public.tenant_memberships
      where tenant_id = '11111111-1111-4111-8111-111111111111'
        and user_id = 'a0000000-0000-4000-8000-000000000001'
        and role = 'owner')::int,
    1,
    'admin: cannot delete the tenant owner'
  )
);

-- Permitted administration must still work, or the policies are simply broken.
update public.tenant_memberships
  set role = 'developer'
  where tenant_id = '11111111-1111-4111-8111-111111111111'
    and user_id = 'a0000000-0000-4000-8000-000000000004';

select t(
  is(
    (select role::text from public.tenant_memberships
      where tenant_id = '11111111-1111-4111-8111-111111111111'
        and user_id = 'a0000000-0000-4000-8000-000000000004'),
    'developer',
    'admin: can promote a viewer to developer, which is within their ceiling'
  )
);

-- ---------------------------------------------------------------------------
-- Owner (Ada). Full membership administration, but not self-service.
-- ---------------------------------------------------------------------------

set local request.jwt.claims =
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

update public.tenant_memberships
  set role = 'security_admin'
  where tenant_id = '11111111-1111-4111-8111-111111111111'
    and user_id = 'a0000000-0000-4000-8000-000000000002';

select t(
  is(
    (select role::text from public.tenant_memberships
      where tenant_id = '11111111-1111-4111-8111-111111111111'
        and user_id = 'a0000000-0000-4000-8000-000000000002'),
    'security_admin',
    'owner: can change another member''s role'
  )
);

-- An owner cannot edit their own membership row at all. Note which mechanism
-- does the work: the UPDATE policy's `user_id <> auth.uid()` excludes the row,
-- so this matches zero rows and never reaches the last-owner trigger. Self
-- role changes are simply not an operation any role can perform.
update public.tenant_memberships
  set role = 'viewer'
  where tenant_id = '11111111-1111-4111-8111-111111111111'
    and user_id = 'a0000000-0000-4000-8000-000000000001';

select t(
  is(
    (select role::text from public.tenant_memberships
      where tenant_id = '11111111-1111-4111-8111-111111111111'
        and user_id = 'a0000000-0000-4000-8000-000000000001'),
    'owner',
    'owner: self-demotion matches no rows and leaves the role intact'
  )
);

-- ---------------------------------------------------------------------------
-- The last-owner trigger, exercised on a privileged path.
--
-- RLS already prevents every client-reachable route to an ownerless tenant, so
-- the trigger is defence-in-depth for server-side and SECURITY DEFINER code.
-- Testing it therefore requires stepping outside RLS, which is exactly the
-- situation it exists to cover. Globex has exactly one owner.
-- ---------------------------------------------------------------------------

reset role;

select t(
  throws_ok(
    $$ delete from public.tenant_memberships
       where tenant_id = '22222222-2222-4222-8222-222222222222'
         and user_id = 'b0000000-0000-4000-8000-000000000001' $$,
    '23514',
    'tenant must retain at least one owner',
    'trigger: deleting a tenant''s sole owner is refused even as a superuser'
  )
);

select t(
  throws_ok(
    $$ update public.tenant_memberships set role = 'admin'
       where tenant_id = '22222222-2222-4222-8222-222222222222'
         and user_id = 'b0000000-0000-4000-8000-000000000001' $$,
    '23514',
    'tenant must retain at least one owner',
    'trigger: demoting a tenant''s sole owner is refused even as a superuser'
  )
);

-- Membership identity is immutable, so a role cannot be walked across a tenant
-- boundary by re-pointing the row instead of editing it.
select t(
  throws_ok(
    $$ update public.tenant_memberships
       set tenant_id = '11111111-1111-4111-8111-111111111111'
       where tenant_id = '22222222-2222-4222-8222-222222222222'
         and user_id = 'b0000000-0000-4000-8000-000000000001' $$,
    '23514',
    'tenant_id of a membership is immutable',
    'trigger: a membership cannot be moved to another tenant'
  )
);
