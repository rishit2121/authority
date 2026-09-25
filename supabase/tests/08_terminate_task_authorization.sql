-- terminate_task() and the non-member authorization boundary.
--
-- This suite exists because of a real, exploitable bug found during
-- security review and fixed in 20260924000002_fix_role_rank_null_bypass.sql:
-- authz.role_rank() returned NULL rather than a low sentinel for a caller
-- with no membership in the target tenant at all, and PL/pgSQL's
-- `if not <expr> then raise` never raises when <expr> is NULL. A caller
-- who was a *member with an insufficient role* was always correctly
-- rejected (role_rank returns a real, non-null number for any real role);
-- the gap was specific to a caller who is a complete stranger to the
-- tenant. Every assertion below that checks "an outsider" is a direct
-- regression test for that gap; the ones that check "a member with the
-- wrong role" are the case that was already correctly handled, included so
-- the two cases stay distinguished if anyone touches this again.

select plan(10);

-- Setup: a fixture task in tenant A, developer-owned, still executing.
insert into public.principals (id, tenant_id, kind, display_name) values
  ('d1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Principal D');

insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('d2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'agent-d', 'openai', 'gpt', 'x',
    'd1000000-0000-4000-8000-000000000001', 'active');

insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('d3000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
    'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Fixture task D', 'executing');

insert into public.plans (id, tenant_id, task_id, input_hash) values
  ('d6000000-0000-4000-8000-000000000099', '11111111-1111-4111-8111-111111111111',
    'd3000000-0000-4000-8000-000000000001', repeat('9', 64));

insert into public.task_authority_contracts (
  id, tenant_id, task_id, plan_id, spec_version, allowed_actions, ephemeral_limits, contract_status,
  registry_version, compiler_version, input_hash, output_hash, data_flow_bindings, required_approvals
) values (
  'd4000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
  'd3000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000099', 'v1', '{"schemaVersion":1,"items":[]}',
  '{"schemaVersion":1,"maxToolInvocations":5,"expiresInSeconds":60}', 'active',
  'fixture-registry', 'fixture-compiler', repeat('a', 64), repeat('b', 64),
  '{"schemaVersion":1,"refs":[]}', '{"schemaVersion":1,"items":[]}'
);

insert into public.tool_requests (
  id, tenant_id, task_id, agent_id, tool, operation, normalized_arguments, idempotency_key
) values (
  'd5000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
  'd3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001',
  'github.read_issue', 'read_issue', '{"schemaVersion":1,"values":{}}', 'fixture-key-d1'
);

insert into public.authorization_decisions (
  id, tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome,
  reason_codes, applied_constraints, latency_ms
) values (
  'd6000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
  'd3000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001', 1, 'allow',
  '{"schemaVersion":1,"items":[]}', '{"schemaVersion":1,"items":[]}', 1
);

insert into public.capabilities (
  id, tenant_id, task_id, authorization_decision_id, agent_id, tool, max_invocations, expires_at, status
) values (
  'd7000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
  'd3000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001', 'github.read_issue', 3, now() + interval '1 hour', 'active'
);

set local role authenticated;

-- ---------------------------------------------------------------------
-- The regression: an outsider with zero membership in tenant A.
-- ---------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select t(throws_ok(
  $$ select public.terminate_task('d3000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'a user with no membership in the task''s tenant cannot terminate it — the role_rank NULL-bypass regression'));

reset role;
select t(is(
  (select status::text from public.tasks where id = 'd3000000-0000-4000-8000-000000000001'),
  'executing',
  'the fixture task is unaffected by the rejected cross-tenant attempt'));
set local role authenticated;

-- The already-correctly-handled case: a real member with too low a role.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}';
-- viewer.a: a genuine tenant A member, rank below the developer+ this RPC requires.

select t(throws_ok(
  $$ select public.terminate_task('d3000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'a tenant member with an insufficient role cannot terminate a task'));

-- ---------------------------------------------------------------------
-- The happy path and its side effects.
-- ---------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
-- dev.a: developer in tenant A, sufficient and a real member.

select t(lives_ok(
  $$ select public.terminate_task('d3000000-0000-4000-8000-000000000001') $$,
  'a developer in the task''s own tenant can terminate it'));

select t(is(
  (select status::text from public.tasks where id = 'd3000000-0000-4000-8000-000000000001'),
  'terminated',
  'the task is marked terminated'));

select t(isnt(
  (select terminated_at from public.tasks where id = 'd3000000-0000-4000-8000-000000000001'),
  null,
  'terminated_at is stamped'));

select t(is(
  (select status::text from public.capabilities where id = 'd7000000-0000-4000-8000-000000000001'),
  'revoked',
  'the task''s active capability is revoked'));

select t(is(
  (select count(*)::int from public.execution_events
    where task_id = 'd3000000-0000-4000-8000-000000000001' and event_type = 'task_terminated'),
  1,
  'exactly one task_terminated event is appended'));

-- ---------------------------------------------------------------------
-- Idempotency: terminating an already-terminated task is a no-op, not an
-- error and not a second event.
-- ---------------------------------------------------------------------

select t(lives_ok(
  $$ select public.terminate_task('d3000000-0000-4000-8000-000000000001') $$,
  'terminating an already-terminated task does not raise'));

select t(is(
  (select count(*)::int from public.execution_events
    where task_id = 'd3000000-0000-4000-8000-000000000001' and event_type = 'task_terminated'),
  1,
  'a repeated termination does not append a second event'));
