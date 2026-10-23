-- Invocation budgets belong to a contract version, not to the task. A new contract for the same task (what
-- re-preparing a task produces, which needs the trusted backend credential, never the agent's) starts with a
-- fresh budget; nothing spent under the previous version carries over. This suite pins that behavior so the
-- documentation cannot drift from it. A task-wide ceiling across versions is not implemented.

select plan(4);

set local role postgres;

insert into public.principals (id, tenant_id, kind, display_name, user_id) values
  ('27000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Owner (dev.a)', 'a0000000-0000-4000-8000-000000000003');
insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('27000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'agent-27', 'openai', 'gpt', 'x', '27000000-0000-4000-8000-000000000001', 'active');
insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('27000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '27000000-0000-4000-8000-000000000002', '27000000-0000-4000-8000-000000000001', 'List Slack channels', 'contract_issued');

create function public.t27_activate(p_id uuid, p_version int, p_max int)
returns void language sql security definer set search_path = '' as $$
  insert into public.task_authority_contracts (
    id, tenant_id, task_id, version, spec_version, allowed_actions, forbidden_resources, forbidden_operations,
    ephemeral_limits, contract_status, registry_version, compiler_version, input_hash, output_hash,
    data_flow_bindings, required_approvals, activated_at, expires_at, required_approvals_spec, demo_key)
  values (p_id, '11111111-1111-4111-8111-111111111111', '27000000-0000-4000-8000-000000000003', p_version, 'v1',
    jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
      jsonb_build_object('tool', 'slack.list_channels', 'constraints', jsonb_build_array(), 'maxInvocations', p_max))),
    '{}', '{}', jsonb_build_object('schemaVersion', 1, 'maxToolInvocations', p_max, 'expiresInSeconds', 3600),
    'active', 'rv1', 'cv1', repeat('9', 64), repeat('8', 64), '{"schemaVersion":1,"refs":[]}'::jsonb,
    '{"schemaVersion":1,"items":[]}'::jsonb, now(), now() + interval '1 hour', '{"schemaVersion":1,"items":[]}'::jsonb,
    'test27:' || p_id::text)
$$;

create function public.t27(p_key text)
returns table (fin public.authorization_outcome, reasons text[])
language sql security definer set search_path = '' as $$
  select c.r_final_outcome, c.r_reason_codes
  from gateway.commit_authorization(
    current_setting('test.secret_27'), '27000000-0000-4000-8000-000000000003', 'slack.list_channels', 'op', null,
    '{}'::jsonb, '{"schemaVersion":1,"count":0,"truncated":false,"entries":[]}'::jsonb, null, p_key, 'rv1', 'cv1',
    'low', 1, encode(extensions.digest('authcap_v1_' || p_key, 'sha256'), 'hex'),
    null, null, null, null, null, '{}'::text[], null, 0.8, 5, repeat('c', 64), '{"schemaVersion":1}'::jsonb,
    null, 'gw-test27', false) c
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select set_config('test.secret_27', r.plaintext_secret, true)
from public.create_agent_credential('27000000-0000-4000-8000-000000000002'::uuid) r;
set local role postgres;

-- Version 1: a budget of 2.
select public.t27_activate('27000000-0000-4000-8000-0000000000a1', 1, 2);
select t(ok((select fin::text from public.t27('k1')) in ('allow', 'allow_constrained'), 'first call under version 1 is allowed'));
select t(ok((select fin::text from public.t27('k2')) in ('allow', 'allow_constrained'), 'second call under version 1 is allowed'));
select t(is((select reasons from public.t27('k3')), array['INVOCATION_LIMIT_REACHED'], 'a third call exhausts version 1''s budget'));

-- Version 2 for the same task (as re-preparing would produce): a fresh budget.
update public.task_authority_contracts set contract_status = 'revoked', revoked_at = now(), revocation_reason = 'test27: replaced'
  where id = '27000000-0000-4000-8000-0000000000a1';
select public.t27_activate('27000000-0000-4000-8000-0000000000a2', 2, 2);
select t(ok((select fin::text from public.t27('k4')) in ('allow', 'allow_constrained'),
  'a new contract version starts with a fresh budget: nothing spent under version 1 carries over'));
select * from finish();
