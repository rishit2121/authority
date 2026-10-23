-- Closed-world arguments (20261023000001): gateway.evaluate_deterministic refuses an argument key that the
-- matched action neither pins nor declares open. Actions without `openArguments` (compiled before the field
-- existed) keep the previous behavior.

select plan(12);

set local role postgres;

insert into public.principals (id, tenant_id, kind, display_name, user_id) values
  ('26000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Owner (dev.a)', 'a0000000-0000-4000-8000-000000000003');
insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('26000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'agent-26', 'openai', 'gpt', 'x', '26000000-0000-4000-8000-000000000001', 'active');
insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('26000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '26000000-0000-4000-8000-000000000002', '26000000-0000-4000-8000-000000000001', 'Open a PR from fix-991 into main, email Alice, post to #ops', 'contract_issued');

insert into public.task_authority_contracts (
  id, tenant_id, task_id, version, spec_version, allowed_actions, forbidden_resources, forbidden_operations,
  ephemeral_limits, contract_status, registry_version, compiler_version, input_hash, output_hash,
  data_flow_bindings, required_approvals, activated_at, expires_at, required_approvals_spec, demo_key)
values ('26000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
  '26000000-0000-4000-8000-000000000003', 1, 'v1',
  '{"schemaVersion":1,"items":[
     {"tool":"github.create_pull_request","constraints":[{"key":"repository","equals":"acme/api"},{"key":"target_branch","equals":"main"}],"maxInvocations":5,"openArguments":[]},
     {"tool":"gmail.send_email","constraints":[{"key":"subject","equals":"Status"},{"key":"to","equals":"alice@example.com"}],"maxInvocations":5,"openArguments":["body"]},
     {"tool":"slack.post_message","constraints":[{"key":"channel","equals":"C-ops"}],"maxInvocations":5}]}'::jsonb,
  '{}', '{}', jsonb_build_object('schemaVersion', 1, 'maxToolInvocations', 50, 'expiresInSeconds', 3600),
  'active', 'rv1', 'cv1', repeat('9', 64), repeat('8', 64), '{"schemaVersion":1,"refs":[]}'::jsonb,
  '{"schemaVersion":1,"items":[]}'::jsonb, now(), now() + interval '1 hour', '{"schemaVersion":1,"items":[]}'::jsonb,
  'test26:closed-world');

create function public.t26(p_tool text, p_args jsonb)
returns table (outcome text, code text)
language sql security definer set search_path = '' as $$
  select e.ed_outcome::text, e.ed_reasons -> 0 ->> 'code'
  from gateway.evaluate_deterministic('11111111-1111-4111-8111-111111111111', '26000000-0000-4000-8000-000000000003',
    p_tool, p_args, 'rv1', 'cv1', 1) e
$$;

-- Closed-world action with no open arguments.
select t(is((select outcome from public.t26('github.create_pull_request', '{"repository":"acme/api","target_branch":"main"}')),
  'allow_constrained', 'the pinned arguments alone are allowed'));
select t(is((select outcome from public.t26('github.create_pull_request', '{"repository":"acme/api","target_branch":"main","head_branch":"attacker-branch"}')),
  'deny', 'an optional key the plan never set is refused'));
select t(is((select code from public.t26('github.create_pull_request', '{"repository":"acme/api","target_branch":"main","head_branch":"attacker-branch"}')),
  'CONSTRAINT_VIOLATION', 'the refusal is a constraint violation'));
select t(is((select outcome from public.t26('github.create_pull_request', '{"repository":"acme/api","target_branch":"main","unknown_flag":"true"}')),
  'deny', 'a key the operation does not even have is refused'));

-- Closed-world action with an open free-text field.
select t(is((select outcome from public.t26('gmail.send_email', '{"to":"alice@example.com","subject":"Status","body":"any text the agent wrote"}')),
  'allow_constrained', 'a declared open (free-text) argument may be supplied with any value'));
select t(is((select outcome from public.t26('gmail.send_email', '{"to":"alice@example.com","subject":"Status"}')),
  'allow_constrained', 'an open argument may also be omitted'));
select t(is((select outcome from public.t26('gmail.send_email', '{"to":"alice@example.com","subject":"Status","cc":"attacker@evil.example"}')),
  'deny', 'an undeclared extra recipient field is refused'));
select t(is((select outcome from public.t26('gmail.send_email', '{"to":"bob@example.com","subject":"Status"}')),
  'deny', 'a pinned argument with a different value is still refused'));

-- Missing versus undeclared.
select t(is((select outcome from public.t26('gmail.send_email', '{"subject":"Status"}')),
  'clarify', 'a missing pinned argument alone still asks for clarification'));
select t(is((select outcome from public.t26('gmail.send_email', '{"subject":"Status","cc":"attacker@evil.example"}')),
  'deny', 'a missing pinned argument plus an undeclared key is refused, not clarified'));

-- Legacy action (no openArguments): unchanged, so the migration can land before the application deploy.
select t(is((select outcome from public.t26('slack.post_message', '{"channel":"C-ops","text":"hi","thread_ts":"123"}')),
  'allow_constrained', 'an action compiled before openArguments existed keeps the previous behavior'));
select t(is((select outcome from public.t26('slack.post_message', '{"channel":"C-other","text":"hi"}')),
  'deny', 'a legacy action still enforces its pinned arguments'));

select * from finish();
