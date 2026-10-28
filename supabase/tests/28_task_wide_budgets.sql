-- Task-wide budgets (20261027000001): an action's allowance spans every contract version of the task; only an
-- explicit raise by the trusted backend (when preparing) or an admin (on the active contract) increases it.

select plan(34);

set local role postgres;

-- Fixtures: an application with a backend key and a customer, a second application with its own key, an agent
-- with a runtime key, and a task for the customer.
insert into public.principals (id, tenant_id, kind, display_name, user_id) values
  ('28000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Dev (dev.a)', 'a0000000-0000-4000-8000-000000000003');
insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('28000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'agent-28', 'openai', 'gpt', 'x', '28000000-0000-4000-8000-000000000001', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select set_config('t28.app', (select app_application_id::text from public.create_application('11111111-1111-4111-8111-111111111111', 'app-28', 'app-28', 'production')), true);
select set_config('t28.app2', (select app_application_id::text from public.create_application('11111111-1111-4111-8111-111111111111', 'app-28b', 'app-28b', 'production')), true);
select set_config('t28.key', (select plaintext_secret from public.create_backend_credential(current_setting('t28.app')::uuid, 'k28')), true);
select set_config('t28.key2', (select plaintext_secret from public.create_backend_credential(current_setting('t28.app2')::uuid, 'k28b')), true);
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select set_config('t28.runtime', (select plaintext_secret from public.create_agent_credential('28000000-0000-4000-8000-000000000002'::uuid)), true);
set local role postgres;

insert into public.customers (id, tenant_id, application_id, external_id) values
  ('28000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', current_setting('t28.app')::uuid, 'cust-28');
insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status, customer_id) values
  ('28000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '28000000-0000-4000-8000-000000000002',
   '28000000-0000-4000-8000-000000000001', 'List Slack channels', 'contract_issued', '28000000-0000-4000-8000-000000000004');

-- A proposed contract with one action (tool, constraints, budget), activated through the real core function.
create function public.t28_propose(p_id uuid, p_version int, p_tool text, p_constraints jsonb, p_max int)
returns void language sql security definer set search_path = '' as $$
  insert into public.task_authority_contracts (
    id, tenant_id, task_id, version, spec_version, allowed_actions, forbidden_resources, forbidden_operations,
    ephemeral_limits, contract_status, registry_version, compiler_version, input_hash, output_hash,
    data_flow_bindings, required_approvals, required_approvals_spec, demo_key)
  values (p_id, '11111111-1111-4111-8111-111111111111', '28000000-0000-4000-8000-000000000003', p_version, 'v1',
    jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
      jsonb_build_object('tool', p_tool, 'constraints', p_constraints, 'maxInvocations', p_max))),
    '{}', '{}', jsonb_build_object('schemaVersion', 1, 'maxToolInvocations', 20, 'expiresInSeconds', 3600),
    'proposed', 'rv1', 'cv1', repeat(to_hex(p_version), 64 / length(to_hex(p_version))), repeat('8', 64),
    '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb,
    'test28:' || p_id::text)
$$;
create function public.t28_activate(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  select gateway.activate_task_contract_core(p_id, '28000000-0000-4000-8000-000000000001')
$$;
create function public.t28(p_key text, p_tool text default 'slack.list_channels', p_args jsonb default '{}'::jsonb)
returns table (fin public.authorization_outcome, reasons text[], remaining integer)
language sql security definer set search_path = '' as $$
  select c.r_final_outcome, c.r_reason_codes, c.r_remaining_invocations
  from gateway.commit_authorization(
    current_setting('t28.runtime'), '28000000-0000-4000-8000-000000000003', p_tool, 'op', null,
    p_args, '{"schemaVersion":1,"count":0,"truncated":false,"entries":[]}'::jsonb, null, p_key, 'rv1', 'cv1',
    'low', 1, encode(extensions.digest('authcap_v1_' || p_key, 'sha256'), 'hex'),
    null, null, null, null, null, '{}'::text[], null, 0.8, 5, repeat('c', 64), '{"schemaVersion":1}'::jsonb,
    null, 'gw-test28', false) c
$$;
create function public.t28_allowance(p_tool text default 'slack.list_channels', p_constraints jsonb default '[]'::jsonb)
returns integer language sql stable security definer set search_path = '' as $$
  select allowance from public.task_action_allowances
  where task_id = '28000000-0000-4000-8000-000000000003' and tool = p_tool
    and resource_constraints = jsonb_build_object('schemaVersion', 1, 'items', p_constraints)
$$;

-- 1. Activation seeds the allowance; the version budget works as before.
select public.t28_propose('28000000-0000-4000-8000-0000000000c1', 1, 'slack.list_channels', '[]', 2);
select public.t28_activate('28000000-0000-4000-8000-0000000000c1');
select t(is(public.t28_allowance(), 2, 'activation seeds the action''s task-wide allowance from its maxInvocations'));
select t(is((select count(*)::int from public.task_budget_changes where task_id = '28000000-0000-4000-8000-000000000003' and change = 'seeded'),
  1, 'and records the seed'));
select t(ok((select fin::text from public.t28('k1')) in ('allow', 'allow_constrained'), 'first call allowed'));
select t(ok((select fin::text from public.t28('k2')) in ('allow', 'allow_constrained'), 'second call allowed'));
select t(is((select reasons from public.t28('k3')), array['INVOCATION_LIMIT_REACHED'], 'third call exhausts the budget'));

-- 2. Re-preparing (a new version, no raise) inherits it.
select public.t28_propose('28000000-0000-4000-8000-0000000000c2', 2, 'slack.list_channels', '[]', 2);
select public.t28_activate('28000000-0000-4000-8000-0000000000c2');
select t(is((select contract_status::text from public.task_authority_contracts where id = '28000000-0000-4000-8000-0000000000c1'),
  'superseded', 'version 2 supersedes version 1'));
select t(is((select reasons from public.t28('k4')), array['INVOCATION_LIMIT_REACHED'], 'version 2 inherits the spent budget'));
select t(ok((select ed_reasons -> 0 ->> 'detail' from gateway.evaluate_deterministic(
    '11111111-1111-4111-8111-111111111111', '28000000-0000-4000-8000-000000000003', 'slack.list_channels', '{}'::jsonb, 'rv1', 'cv1', 1))
  like '%task-wide budget is exhausted%', 'the denial says the task-wide budget is exhausted'));
select set_config('t28.rows', (select count(*)::text from public.task_action_allowances), true);
select gateway.evaluate_deterministic('11111111-1111-4111-8111-111111111111', '28000000-0000-4000-8000-000000000003',
  'slack.list_channels', '{}'::jsonb, 'rv1', 'cv1', 1);
select t(is((select count(*)::text from public.task_action_allowances), current_setting('t28.rows'),
  'evaluation alone (the preview path) writes nothing'));

-- 3. A refund under version 1 carries over to version 2.
update public.capability_tokens set status = 'revoked', revoked_at = now(), revoked_by = 'system', revocation_reason = 'test28'
  where token_hash = encode(extensions.digest('authcap_v1_k1', 'sha256'), 'hex');
select gateway.sweep_task_budgets('28000000-0000-4000-8000-000000000003');
select t(ok((select fin::text from public.t28('k5')) in ('allow', 'allow_constrained'), 'an unused use refunded under version 1 can be spent under version 2'));
select t(is((select reasons from public.t28('k6')), array['INVOCATION_LIMIT_REACHED'], 'and only that one'));
select t(is(gateway.remaining_for_budget((select id from public.capabilities where contract_id = '28000000-0000-4000-8000-0000000000c2')),
  0, 'remaining is the lower of the version''s (1) and the task''s (0)'));

-- 4. The backend's explicit raise.
select public.t28_propose('28000000-0000-4000-8000-0000000000c3', 3, 'slack.list_channels', '[]', 2);
select t(isnt(gateway.request_budget_raise_for_backend(current_setting('t28.runtime'), '28000000-0000-4000-8000-0000000000c3'),
  'ok', 'an agent runtime key cannot request a raise'));
select t(isnt(gateway.request_budget_raise_for_backend('authority_ts_' || repeat('a', 64), '28000000-0000-4000-8000-0000000000c3'),
  'ok', 'a task session token cannot request a raise'));
select t(is(gateway.request_budget_raise_for_backend(current_setting('t28.key2'), '28000000-0000-4000-8000-0000000000c3'),
  'not_found', 'another application''s backend key cannot request a raise'));
select t(is(gateway.request_budget_raise_for_backend(current_setting('t28.key'), '28000000-0000-4000-8000-0000000000c2'),
  'not_eligible', 'an already active contract cannot be given a raise this way'));
select t(is((select count(*)::int from public.contract_budget_raise_requests), 0, 'none of those recorded anything'));
select t(is(gateway.request_budget_raise_for_backend(current_setting('t28.key'), '28000000-0000-4000-8000-0000000000c3'),
  'ok', 'the task''s own backend may request a raise for a proposed contract'));
select public.t28_activate('28000000-0000-4000-8000-0000000000c3');
select t(is(public.t28_allowance(), 4, 'activation applies it: allowance = used (2) + maxInvocations (2)'));
select t(is((select actor_kind from public.task_budget_changes where change = 'raised' and task_id = '28000000-0000-4000-8000-000000000003'),
  'backend', 'and records who raised it'));
select t(ok((select fin::text from public.t28('k7')) in ('allow', 'allow_constrained'), 'the raised budget can be spent'));
select t(ok((select fin::text from public.t28('k8')) in ('allow', 'allow_constrained'), 'up to its new limit'));
select t(is((select reasons from public.t28('k9')), array['INVOCATION_LIMIT_REACHED'], 'and no further'));

-- 5. A person's raise: admins and owners of the task's tenant only.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(is(public.raise_task_budgets('28000000-0000-4000-8000-000000000003', 'more'), 'forbidden', 'a developer cannot raise budgets'));
select t(throws_ok($$ insert into public.task_action_allowances (tenant_id, task_id, tool, resource_constraints, allowance)
  values ('11111111-1111-4111-8111-111111111111', '28000000-0000-4000-8000-000000000003', 'slack.list_channels', '{"schemaVersion":1,"items":[]}', 99) $$,
  '42501', null, 'no client can write an allowance directly'));
select t(throws_ok($$ update public.task_action_allowances set allowance = 99 $$, '42501', null, 'or change one'));
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(is(public.raise_task_budgets('28000000-0000-4000-8000-000000000003', 'more'), 'not_found', 'another tenant''s owner cannot see the task'));
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select t(is(public.raise_task_budgets('28000000-0000-4000-8000-000000000003', 'customer asked for two more lookups'), 'ok', 'an admin can'));
set local role postgres;
select t(is(public.t28_allowance(), 6, 'renewing gives the active version''s maxInvocations again on top of what was used (4 + 2)'));
set local role anon;
select t(throws_ok($$ select public.raise_task_budgets('28000000-0000-4000-8000-000000000003', 'x') $$, '42501', null, 'anonymous callers cannot raise budgets'));
set local role postgres;
select t(throws_ok($$ update public.task_budget_changes set note = 'x' $$, '23514', null, 'the budget audit is append-only'));

-- 6. A different pinned value is a different action, with its own allowance.
select public.t28_propose('28000000-0000-4000-8000-0000000000c4', 4, 'slack.post_message', '[{"key":"channel","equals":"C-1"}]', 3);
select public.t28_activate('28000000-0000-4000-8000-0000000000c4');
select t(is(public.t28_allowance('slack.post_message', '[{"key":"channel","equals":"C-1"}]'), 3, 'a new action identity is seeded with its own allowance'));

-- 7. Backfill: an active contract from before the migration keeps exactly its remaining budget.
insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('28000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', '28000000-0000-4000-8000-000000000002',
   '28000000-0000-4000-8000-000000000001', 'Backfill fixture', 'contract_issued');
insert into public.task_authority_contracts (id, tenant_id, task_id, version, spec_version, allowed_actions, forbidden_resources,
  forbidden_operations, ephemeral_limits, contract_status, registry_version, compiler_version, input_hash, output_hash,
  data_flow_bindings, required_approvals, activated_at, expires_at, superseded_at, required_approvals_spec, demo_key)
values
  ('28000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', '28000000-0000-4000-8000-000000000005', 1, 'v1',
   '{"schemaVersion":1,"items":[{"tool":"slack.list_channels","constraints":[],"maxInvocations":3}]}',
   '{}', '{}', '{"schemaVersion":1,"maxToolInvocations":3,"expiresInSeconds":3600}', 'active', 'rv1', 'cv1',
   repeat('d', 64), repeat('8', 64), '{"schemaVersion":1,"refs":[]}', '{"schemaVersion":1,"items":[]}', now(), now() + interval '1 hour',
   null, '{"schemaVersion":1,"items":[]}', 'test28:d1'),
  ('28000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', '28000000-0000-4000-8000-000000000005', 2, 'v1',
   '{"schemaVersion":1,"items":[{"tool":"slack.list_channels","constraints":[],"maxInvocations":3}]}',
   '{}', '{}', '{"schemaVersion":1,"maxToolInvocations":3,"expiresInSeconds":3600}', 'proposed', 'rv1', 'cv1',
   repeat('e', 64), repeat('8', 64), '{"schemaVersion":1,"refs":[]}', '{"schemaVersion":1,"items":[]}', null, null,
   null, '{"schemaVersion":1,"items":[]}', 'test28:d2');
-- Usage recorded the way it was before the migration: the allowance rows the seeding trigger adds are removed below.
insert into public.capabilities (tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
  max_invocations, consumed_uses, expires_at, contract_id)
values ('11111111-1111-4111-8111-111111111111', '28000000-0000-4000-8000-000000000005', gen_random_uuid(),
  '28000000-0000-4000-8000-000000000002', 'slack.list_channels', '{"schemaVersion":1,"items":[]}', 3, 2, now() + interval '1 hour',
  '28000000-0000-4000-8000-0000000000d1');
update public.task_authority_contracts set contract_status = 'superseded', superseded_at = now(),
  superseded_by_contract_id = '28000000-0000-4000-8000-0000000000d2' where id = '28000000-0000-4000-8000-0000000000d1';
update public.task_authority_contracts set contract_status = 'active', activated_at = now(), expires_at = now() + interval '1 hour'
  where id = '28000000-0000-4000-8000-0000000000d2';
insert into public.capabilities (tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
  max_invocations, consumed_uses, expires_at, contract_id)
values ('11111111-1111-4111-8111-111111111111', '28000000-0000-4000-8000-000000000005', gen_random_uuid(),
  '28000000-0000-4000-8000-000000000002', 'slack.list_channels', '{"schemaVersion":1,"items":[]}', 3, 1, now() + interval '1 hour',
  '28000000-0000-4000-8000-0000000000d2');
delete from public.task_action_allowances where task_id = '28000000-0000-4000-8000-000000000005';
select gateway.backfill_task_action_allowances();
select t(is((select allowance from public.task_action_allowances where task_id = '28000000-0000-4000-8000-000000000005'), 5,
  'backfill keeps the active version''s remaining budget: (2 + 1) used in all versions - 1 under the active one + 3'));
select t(is(gateway.backfill_task_action_allowances(), 0, 'running the backfill again changes nothing'));

select * from finish();
