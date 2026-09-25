-- create_task(): the fixed-purpose task-creation RPC.

select plan(11);

-- Fixture agent/principal in tenant A to attach tasks to.
insert into public.principals (id, tenant_id, kind, display_name) values
  ('e1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Principal E');

insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('e2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'agent-e', 'openai', 'gpt', 'x',
    'e1000000-0000-4000-8000-000000000001', 'active');

-- And in tenant B, so cross-tenant identifier rejection has something real
-- to reject against.
insert into public.principals (id, tenant_id, kind, display_name) values
  ('f1000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'human', 'Fixture Principal F');

insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('f2000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'agent-f', 'openai', 'gpt', 'x',
    'f1000000-0000-4000-8000-000000000001', 'active');

set local role authenticated;

-- ---------------------------------------------------------------------
-- The role_rank NULL-bypass regression, for the third and final affected
-- RPC: a caller with zero membership in the target tenant.
-- ---------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select t(throws_ok(
  $$ select public.create_task(
       '11111111-1111-4111-8111-111111111111', 'e2000000-0000-4000-8000-000000000001',
       'e1000000-0000-4000-8000-000000000001', 'Cross-tenant attempt', 'app_form', null
     ) $$,
  '42501', null,
  'a user with no membership in the target tenant cannot create a task there'));

-- A real member with an insufficient role.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}';
-- viewer.a: genuine tenant A member, below the developer+ this RPC requires.

select t(throws_ok(
  $$ select public.create_task(
       '11111111-1111-4111-8111-111111111111', 'e2000000-0000-4000-8000-000000000001',
       'e1000000-0000-4000-8000-000000000001', 'Viewer attempt', 'app_form', null
     ) $$,
  '42501', null,
  'a viewer cannot create a task, even in their own tenant'));

-- ---------------------------------------------------------------------
-- Cross-tenant identifier rejection.
-- ---------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
-- dev.a: developer in tenant A, sufficient and a real member.

select t(throws_ok(
  $$ select public.create_task(
       '11111111-1111-4111-8111-111111111111', 'f2000000-0000-4000-8000-000000000001',
       'e1000000-0000-4000-8000-000000000001', 'Cross-tenant agent', 'app_form', null
     ) $$,
  '23503', 'agent does not belong to the target tenant',
  'a task cannot be created with an agent from another tenant'));

select t(throws_ok(
  $$ select public.create_task(
       '11111111-1111-4111-8111-111111111111', 'e2000000-0000-4000-8000-000000000001',
       'f1000000-0000-4000-8000-000000000001', 'Cross-tenant principal', 'app_form', null
     ) $$,
  '23503', 'principal does not belong to the target tenant',
  'a task cannot be created with a principal from another tenant'));

-- ---------------------------------------------------------------------
-- Validation.
-- ---------------------------------------------------------------------

select t(throws_ok(
  $$ select public.create_task(
       '11111111-1111-4111-8111-111111111111', 'e2000000-0000-4000-8000-000000000001',
       'e1000000-0000-4000-8000-000000000001', '   ', 'app_form', null
     ) $$,
  '22023', 'trusted objective must not be empty',
  'a blank trusted objective is rejected'));

-- ---------------------------------------------------------------------
-- The happy path.
-- ---------------------------------------------------------------------

select t(is(
  (select was_created from public.create_task(
     '11111111-1111-4111-8111-111111111111', 'e2000000-0000-4000-8000-000000000001',
     'e1000000-0000-4000-8000-000000000001', 'Resolve issue #4200', 'app_form', 'probe-key-1'
   )),
  true,
  'a developer can create a task in their own tenant'));

select t(is(
  (select status::text from public.tasks
     where tenant_id = '11111111-1111-4111-8111-111111111111' and idempotency_key = 'probe-key-1'),
  'pending',
  'the new task starts pending — the pre-contract state, no schema change needed'));

select t(is(
  (select intent from public.tasks
     where tenant_id = '11111111-1111-4111-8111-111111111111' and idempotency_key = 'probe-key-1'),
  'Resolve issue #4200',
  'the trusted objective is stored as the task''s intent'));

-- ---------------------------------------------------------------------
-- Idempotency.
-- ---------------------------------------------------------------------

select t(is(
  (select was_created from public.create_task(
     '11111111-1111-4111-8111-111111111111', 'e2000000-0000-4000-8000-000000000001',
     'e1000000-0000-4000-8000-000000000001', 'A different objective text', 'app_form', 'probe-key-1'
   )),
  false,
  'a retry with the same idempotency key reports was_created = false'));

select t(is(
  (select count(*)::int from public.tasks
     where tenant_id = '11111111-1111-4111-8111-111111111111' and idempotency_key = 'probe-key-1'),
  1,
  'exactly one task exists for the idempotency key, despite two calls'));
