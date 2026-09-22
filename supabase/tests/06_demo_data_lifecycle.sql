-- Part 2B.1: demo-data installer and reset — idempotency and tenant scoping.
--
-- Runs against tenant B (Globex Payments), which starts this suite with no
-- demo data. Whatever this suite does to B, the harness's rollback at the
-- end undoes — but the assertions about tenant A are what prove B's demo
-- lifecycle never reaches outside its own tenant, which matters more than
-- the rollback: a bug here would show up as tenant A's *committed* demo
-- data changing mid-test, not as something the rollback happens to hide.

select plan(12);

set local role authenticated;

-- A privilege check first: only admin+ may install or reset.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
-- dev.a: developer in tenant A, below the admin+ this RPC requires.

select t(throws_ok(
  $$ select public.install_demo_workspace('11111111-1111-4111-8111-111111111111') $$,
  '42501', null,
  'a developer cannot install demo data, even for their own tenant'));

-- Regression for the role_rank NULL-bypass fixed in
-- 20260924000002_fix_role_rank_null_bypass.sql: a caller with *zero*
-- membership in the target tenant — not merely an insufficient role in
-- it — must be rejected too. Before that fix, authz.can_manage_tenant()
-- returned NULL rather than false for a non-member, and PL/pgSQL's
-- `if not <NULL> then raise` silently never raised.
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
-- owner.b holds no membership in tenant A at all.

select t(throws_ok(
  $$ select public.install_demo_workspace('11111111-1111-4111-8111-111111111111') $$,
  '42501', null,
  'a user with no membership in the target tenant cannot install demo data there'));

select t(throws_ok(
  $$ select public.reset_demo_workspace('11111111-1111-4111-8111-111111111111') $$,
  '42501', null,
  'a user with no membership in the target tenant cannot reset demo data there'));

-- Switch to tenant B's owner and confirm the starting state.
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select t(is(
  (select count(*) from public.tasks where tenant_id = '22222222-2222-4222-8222-222222222222')::int, 0,
  'tenant B starts this suite with no tasks'));

-- Install.
select t(is(
  (select was_installed from public.install_demo_workspace('22222222-2222-4222-8222-222222222222')),
  true,
  'installing for tenant B for the first time reports was_installed = true'));

select t(is(
  (select count(*) from public.tasks where tenant_id = '22222222-2222-4222-8222-222222222222')::int, 2,
  'tenant B now has the fixed demo dataset''s two tasks'));

-- Switching back to owner.a to check tenant A's own count: RLS scopes every
-- query to the caller's own membership, so checking tenant A's row count
-- while signed in as B would read 0 regardless of whether A's data still
-- exists — that would test RLS isolation, not demo-install scoping.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select t(is(
  (select count(*) from public.agents where tenant_id = '11111111-1111-4111-8111-111111111111')::int, 2,
  'tenant A''s agent count is unaffected by installing demo data for tenant B'));

set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- Idempotency: install again.
select t(is(
  (select was_installed from public.install_demo_workspace('22222222-2222-4222-8222-222222222222')),
  false,
  'installing for tenant B a second time reports was_installed = false'));

select t(is(
  (select count(*) from public.tasks where tenant_id = '22222222-2222-4222-8222-222222222222')::int, 2,
  'a second install adds no additional tasks for tenant B'));

-- Reset.
select public.reset_demo_workspace('22222222-2222-4222-8222-222222222222');

select t(is(
  (select count(*) from public.tasks where tenant_id = '22222222-2222-4222-8222-222222222222')::int, 0,
  'resetting tenant B removes its demo tasks'));

select t(is(
  (select count(*) from public.principals where tenant_id = '22222222-2222-4222-8222-222222222222')::int, 0,
  'resetting tenant B removes its demo principals too — full teardown, not a partial one'));

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select t(is(
  (select count(*) from public.tasks where tenant_id = '11111111-1111-4111-8111-111111111111')::int, 2,
  'tenant A''s tasks are still exactly as they were — reset never crossed the tenant boundary'));
