-- Agent-generated arguments on plan nodes (20261028000001): persisted with the node, empty by default, and never
-- also pinned, taken from an earlier step, duplicated or malformed.

select plan(10);

insert into public.principals (id, tenant_id, kind, display_name) values
  ('29000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Principal 29');
insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('29000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'agent-29', 'openai', 'gpt', 'x',
    '29000000-0000-4000-8000-000000000001', 'active');
insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('29000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
    '29000000-0000-4000-8000-000000000002', '29000000-0000-4000-8000-000000000001', 'Post a summary', 'pending');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';

create function pg_temp.t29_plan(p_node jsonb, p_hash text) returns boolean language sql as $$
  select was_created from public.create_candidate_plan('29000000-0000-4000-8000-000000000003'::uuid,
    jsonb_build_array(jsonb_build_object('id', 'post', 'sequence', 0, 'tool', 'slack.post_message', 'dependencies', '[]'::jsonb,
      'declared_outputs', '[]'::jsonb, 'data_flow_refs', '[]'::jsonb, 'max_invocations', 1, 'validation_status', 'accepted') || p_node),
    p_hash, null)
$$;

select t(ok(pg_temp.t29_plan('{"arguments":{"channel":"C-eng"},"agent_generated":["text"]}', repeat('a', 64)),
  'a node can mark a free-text argument as agent-generated'));
select t(is((select agent_generated from public.plan_nodes n join public.plans p on p.id = n.plan_id
              where p.task_id = '29000000-0000-4000-8000-000000000003' and p.input_hash = repeat('a', 64)),
  array['text'], 'and it is persisted with the node'));
select t(ok(pg_temp.t29_plan('{"arguments":{"channel":"C-eng","text":"Hi"}}', repeat('b', 64)),
  'a node without the field is still accepted'));
select t(is((select agent_generated from public.plan_nodes n join public.plans p on p.id = n.plan_id
              where p.task_id = '29000000-0000-4000-8000-000000000003' and p.input_hash = repeat('b', 64)),
  '{}'::text[], 'and defaults to none'));
select t(throws_ok($$ select pg_temp.t29_plan('{"arguments":{"channel":"C-eng","text":"Hi"},"agent_generated":["text"]}', repeat('c', 64)) $$,
  '23514', null, 'a pinned argument cannot also be agent-generated'));
select t(throws_ok($$ select public.create_candidate_plan('29000000-0000-4000-8000-000000000003'::uuid,
    '[{"id":"read","sequence":0,"tool":"linear.get_issue","arguments":{"issue_id":"ENG-1"},"dependencies":[],"declared_outputs":["issue"],"data_flow_refs":[],"max_invocations":1,"validation_status":"accepted"},
      {"id":"post","sequence":1,"tool":"slack.post_message","arguments":{"channel":"C-eng"},"dependencies":[],"declared_outputs":[],"data_flow_refs":[{"argumentKey":"text","fromNodeId":"read","output":"issue"}],"agent_generated":["text"],"max_invocations":1,"validation_status":"accepted"}]'::jsonb,
    repeat('d', 64), null) $$,
  '23514', null, 'an argument taken from an earlier step cannot also be agent-generated'));
select t(ok((select was_created from public.create_candidate_plan('29000000-0000-4000-8000-000000000003'::uuid,
    '[{"id":"post","sequence":0,"tool":"slack.post_message","arguments":{"channel":"C-eng","text":"Hi"},"dependencies":[],"declared_outputs":[],"data_flow_refs":[],"agent_generated":["text"],"max_invocations":1,"validation_status":"replan"}]'::jsonb,
    repeat('9', 64), null)),
  'a step the validator excluded is stored as submitted, so its reasons can be reported'));
select t(throws_ok($$ select pg_temp.t29_plan('{"arguments":{"channel":"C-eng"},"agent_generated":["text","text"]}', repeat('e', 64)) $$,
  '23514', null, 'duplicates are refused'));
select t(throws_ok($$ select pg_temp.t29_plan('{"arguments":{"channel":"C-eng"},"agent_generated":["te xt"]}', repeat('f', 64)) $$,
  '23514', null, 'a malformed key is refused'));
select t(throws_ok($$ update public.plan_nodes set agent_generated = '{channel}' $$,
  '42501', null, 'no client can change which arguments are agent-generated'));

select * from finish();
