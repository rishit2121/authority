-- Tenant isolation and unauthenticated denial.
--
-- Fixture (supabase/seed.sql):
--   Northwind Labs  11111111-…  owner Ada / admin Amin / developer Devi / viewer Vera
--   Globex Payments 22222222-…  owner Bo
--
-- Run by `npm run db:test`. The harness wraps this file in a transaction that
-- is always rolled back, exposes t(text) for recording assertions, and adds
-- finish() afterwards.

select plan(11);

-- ---------------------------------------------------------------------------
-- Unauthenticated access.
-- ---------------------------------------------------------------------------

-- anon holds no privileges on any Part 2A table, so access fails before RLS is
-- consulted. That is the intended belt-and-braces: a policy mistake alone
-- cannot expose these tables to the public role.
select t(
  throws_ok(
    $$ set local role anon; select count(*) from public.tenants $$,
    '42501',
    null,
    'unauthenticated: anon is denied on tenants'
  )
);

select t(
  throws_ok(
    $$ set local role anon; select count(*) from public.tenant_memberships $$,
    '42501',
    null,
    'unauthenticated: anon is denied on tenant_memberships'
  )
);

select t(
  throws_ok(
    $$ set local role anon; select count(*) from public.profiles $$,
    '42501',
    null,
    'unauthenticated: anon is denied on profiles'
  )
);

-- ---------------------------------------------------------------------------
-- As Ada, owner of Northwind (tenant A).
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select t(
  is(
    (select count(*) from public.profiles)::int,
    1,
    'profiles: A sees exactly one profile, their own'
  )
);

select t(
  is(
    (select count(*) from public.profiles
      where user_id = 'b0000000-0000-4000-8000-000000000001')::int,
    0,
    'profiles: A cannot read B''s profile'
  )
);

select t(
  is(
    (select count(*) from public.tenants
      where id = '22222222-2222-4222-8222-222222222222')::int,
    0,
    'tenants: A cannot read tenant B'
  )
);

select t(
  is(
    (select count(*) from public.tenant_memberships
      where tenant_id = '22222222-2222-4222-8222-222222222222')::int,
    0,
    'memberships: A cannot read tenant B''s memberships'
  )
);

-- Positive control: isolation must not be achieved by denying everything.
select t(
  is(
    (select count(*) from public.tenant_memberships
      where tenant_id = '11111111-1111-4111-8111-111111111111')::int,
    4,
    'memberships: A sees all four members of their own tenant'
  )
);

select t(
  is(
    (select name from public.tenants
      where id = '11111111-1111-4111-8111-111111111111'),
    'Northwind Labs',
    'tenants: A can read their own tenant'
  )
);

-- ---------------------------------------------------------------------------
-- As Bo, owner of Globex (tenant B). The mirror image.
-- ---------------------------------------------------------------------------

set local request.jwt.claims =
  '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select t(
  is(
    (select count(*) from public.tenants)::int,
    1,
    'tenants: B sees only their own tenant'
  )
);

-- A cross-tenant write must fail as surely as a cross-tenant read. RLS makes
-- the UPDATE match zero rows rather than raise, so the proof is that tenant A
-- is unchanged when read back outside B's session.
update public.tenants
  set name = 'Renamed by an outsider'
  where id = '11111111-1111-4111-8111-111111111111';

reset role;

select t(
  is(
    (select name from public.tenants
      where id = '11111111-1111-4111-8111-111111111111'),
    'Northwind Labs',
    'tenants: B''s attempt to rename tenant A changed nothing'
  )
);
