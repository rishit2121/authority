-- create_candidate_plan(): authorization, idempotency, structural integrity.
--
-- Every assertion here was already exercised once via an ad hoc rolled-back
-- dry run against the linked project during design review (see the Part 3A
-- completion report); this suite is the permanent, repeatable form of that
-- same verification.

select plan(14);

insert into public.principals (id, tenant_id, kind, display_name) values
  ('f1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Principal F');
insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('f2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'agent-f', 'openai', 'gpt', 'x',
    'f1000000-0000-4000-8000-000000000001', 'active');
insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('f3000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
    'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Fixture task F', 'pending');

set local role authenticated;

-- Non-member: zero membership in tenant A.
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(throws_ok(
  $$ select public.create_candidate_plan('f3000000-0000-4000-8000-000000000001'::uuid,
       '[{"id":"a","sequence":0,"tool":"github.get_issue","arguments":{"issue_number":"1"},"dependencies":[],"declared_outputs":[],"data_flow_refs":[],"max_invocations":1,"validation_status":"accepted"}]'::jsonb,
       repeat('1', 64), null) $$,
  '42501', null, 'a non-member cannot create a candidate plan for this task — role_rank NULL-bypass regression'));

-- Insufficient role: a real member, but only viewer.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}';
select t(throws_ok(
  $$ select public.create_candidate_plan('f3000000-0000-4000-8000-000000000001'::uuid,
       '[{"id":"a","sequence":0,"tool":"github.get_issue","arguments":{"issue_number":"1"},"dependencies":[],"declared_outputs":[],"data_flow_refs":[],"max_invocations":1,"validation_status":"accepted"}]'::jsonb,
       repeat('2', 64), null) $$,
  '42501', null, 'a viewer (insufficient role) cannot create a candidate plan'));

-- Unknown task.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(throws_ok(
  $$ select public.create_candidate_plan('00000000-0000-4000-8000-000000000000'::uuid,
       '[{"id":"a","sequence":0,"tool":"github.get_issue","arguments":{"issue_number":"1"},"dependencies":[],"declared_outputs":[],"data_flow_refs":[],"max_invocations":1,"validation_status":"accepted"}]'::jsonb,
       repeat('3', 64), null) $$,
  'P0002', null, 'an unknown task raises P0002'));

-- Happy path: developer, valid two-node plan with a dependency and data-flow ref.
select t(is(
  (select was_created from public.create_candidate_plan('f3000000-0000-4000-8000-000000000001'::uuid,
     '[{"id":"read-issue","sequence":0,"tool":"github.get_issue","arguments":{"issue_number":"991"},"dependencies":[],"declared_outputs":["issue_title"],"data_flow_refs":[],"max_invocations":1,"validation_status":"accepted"},
       {"id":"create-branch","sequence":1,"tool":"github.create_branch","arguments":{"repository":"payments-api"},"dependencies":["read-issue"],"declared_outputs":[],"data_flow_refs":[{"argumentKey":"branch","fromNodeId":"read-issue","output":"issue_title"}],"max_invocations":1,"validation_status":"accepted"}]'::jsonb,
     repeat('a', 64), 'idem-1')),
  true,
  'a developer creates a valid plan with a dependency and a data-flow reference'));

select t(is(
  (select count(*)::int from public.plan_nodes n join public.plans p on p.id = n.plan_id
    where p.task_id = 'f3000000-0000-4000-8000-000000000001' and p.idempotency_key = 'idem-1'),
  2,
  'both nodes were persisted atomically'));

-- Idempotent retry: same key, same hash -> returns existing, was_created=false.
select t(is(
  (select was_created from public.create_candidate_plan('f3000000-0000-4000-8000-000000000001'::uuid,
     '[{"id":"read-issue","sequence":0,"tool":"github.get_issue","arguments":{"issue_number":"991"},"dependencies":[],"declared_outputs":["issue_title"],"data_flow_refs":[],"max_invocations":1,"validation_status":"accepted"},
       {"id":"create-branch","sequence":1,"tool":"github.create_branch","arguments":{"repository":"payments-api"},"dependencies":["read-issue"],"declared_outputs":[],"data_flow_refs":[{"argumentKey":"branch","fromNodeId":"read-issue","output":"issue_title"}],"max_invocations":1,"validation_status":"accepted"}]'::jsonb,
     repeat('a', 64), 'idem-1')),
  false,
  'an identical retry (same key, same hash) returns the existing plan, not a new version'));

select t(is(
  (select count(*)::int from public.plans where task_id = 'f3000000-0000-4000-8000-000000000001'),
  1,
  'the identical retry did not create a second plan version'));

-- Same key, different hash -> explicit failure.
select t(throws_ok(
  $$ select public.create_candidate_plan('f3000000-0000-4000-8000-000000000001'::uuid,
       '[{"id":"x","sequence":0,"tool":"github.get_issue","arguments":{"issue_number":"2"},"dependencies":[],"declared_outputs":[],"data_flow_refs":[],"max_invocations":1,"validation_status":"accepted"}]'::jsonb,
       repeat('b', 64), 'idem-1') $$,
  '23505', null, 'reusing an idempotency key with different content fails explicitly'));

-- No idempotency key: always creates a new version.
select t(is(
  (select version from public.create_candidate_plan('f3000000-0000-4000-8000-000000000001'::uuid,
     '[{"id":"y","sequence":0,"tool":"github.get_issue","arguments":{"issue_number":"3"},"dependencies":[],"declared_outputs":[],"data_flow_refs":[],"max_invocations":1,"validation_status":"accepted"}]'::jsonb,
     repeat('c', 64), null)),
  2,
  'a call with no idempotency key always creates a new version'));

-- Duplicate node key within one submission.
select t(throws_ok(
  $$ select public.create_candidate_plan('f3000000-0000-4000-8000-000000000001'::uuid,
       '[{"id":"dup","sequence":0,"tool":"github.get_issue","arguments":{"issue_number":"1"},"dependencies":[],"declared_outputs":[],"data_flow_refs":[],"max_invocations":1,"validation_status":"accepted"},
         {"id":"dup","sequence":1,"tool":"github.read_repository","arguments":{"repository":"r"},"dependencies":[],"declared_outputs":[],"data_flow_refs":[],"max_invocations":1,"validation_status":"accepted"}]'::jsonb,
       repeat('d', 64), null) $$,
  '23505', null, 'a duplicate node key within one submission is rejected'));

-- Forward dependency reference.
select t(throws_ok(
  $$ select public.create_candidate_plan('f3000000-0000-4000-8000-000000000001'::uuid,
       '[{"id":"a","sequence":0,"tool":"github.get_issue","arguments":{"issue_number":"1"},"dependencies":["b"],"declared_outputs":[],"data_flow_refs":[],"max_invocations":1,"validation_status":"accepted"},
         {"id":"b","sequence":1,"tool":"github.read_repository","arguments":{"repository":"r"},"dependencies":[],"declared_outputs":[],"data_flow_refs":[],"max_invocations":1,"validation_status":"accepted"}]'::jsonb,
       repeat('e', 64), null) $$,
  '23514', null, 'a forward dependency reference is rejected'));

-- Data-flow reference to an undeclared output.
select t(throws_ok(
  $$ select public.create_candidate_plan('f3000000-0000-4000-8000-000000000001'::uuid,
       '[{"id":"a","sequence":0,"tool":"github.get_issue","arguments":{"issue_number":"1"},"dependencies":[],"declared_outputs":["out1"],"data_flow_refs":[],"max_invocations":1,"validation_status":"accepted"},
         {"id":"b","sequence":1,"tool":"github.read_repository","arguments":{},"dependencies":[],"declared_outputs":[],"data_flow_refs":[{"argumentKey":"repository","fromNodeId":"a","output":"not_declared"}],"max_invocations":1,"validation_status":"accepted"}]'::jsonb,
       repeat('f', 64), null) $$,
  '23514', null, 'a data-flow reference to an undeclared output is rejected'));

-- Bounded input size.
select t(throws_ok(
  $$ select public.create_candidate_plan('f3000000-0000-4000-8000-000000000001'::uuid,
       (select jsonb_agg(jsonb_build_object('id', 'n'||i, 'sequence', i, 'tool', 'github.get_issue',
         'arguments', jsonb_build_object('issue_number', i::text), 'dependencies', '[]'::jsonb,
         'declared_outputs', '[]'::jsonb, 'data_flow_refs', '[]'::jsonb, 'max_invocations', 1,
         'validation_status', 'accepted'))
        from generate_series(0, 50) as i),
       repeat('1', 64), null) $$,
  '22023', null, '51 nodes exceeds the bounded input size'));
