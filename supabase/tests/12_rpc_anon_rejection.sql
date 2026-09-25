-- Confirms the four client-facing SECURITY DEFINER RPCs are unreachable by
-- an unauthenticated caller — not merely rejected once inside, but denied at
-- the privilege layer before the function body ever runs. Each RPC's own
-- migration revokes EXECUTE from `anon`/`public` and grants it only to
-- `authenticated` (20260923000010_demo_data_rpcs.sql,
-- 20260924000003_create_task_rpc.sql); this suite is the regression test for
-- that grant actually holding, requested explicitly by the security review
-- alongside the non-member and insufficient-role cases already covered in
-- 06_demo_data_lifecycle.sql, 08_terminate_task_authorization.sql and
-- 09_create_task.sql.

select plan(4);

set local role anon;

select t(throws_ok(
  $$ select public.install_demo_workspace('11111111-1111-4111-8111-111111111111') $$,
  '42501', null,
  'anon cannot call install_demo_workspace at all'));

select t(throws_ok(
  $$ select public.reset_demo_workspace('11111111-1111-4111-8111-111111111111') $$,
  '42501', null,
  'anon cannot call reset_demo_workspace at all'));

select t(throws_ok(
  $$ select public.terminate_task('00000000-0000-4000-8000-000000000000') $$,
  '42501', null,
  'anon cannot call terminate_task at all'));

select t(throws_ok(
  $$ select public.create_task('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000000',
       '00000000-0000-4000-8000-000000000000', 'audit objective') $$,
  '42501', null,
  'anon cannot call create_task at all'));
