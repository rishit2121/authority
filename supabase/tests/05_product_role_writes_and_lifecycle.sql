-- Part 2B.1: role-gated writes, append-only evidence, and immutable
-- lifecycle states.
--
-- Fixtures created fresh in this transaction, as in 04_product_tenant_
-- isolation.sql. Different ids are used so the two suites never collide if
-- ever run inside the same transaction.

select plan(17);

-- Setup ---------------------------------------------------------------

insert into public.principals (id, tenant_id, kind, display_name) values
  ('c1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Principal C');

insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('c2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'agent-c', 'openai', 'gpt', 'x',
    'c1000000-0000-4000-8000-000000000001', 'active');

insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('c3000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
    'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Fixture task C', 'executing');

insert into public.plans (id, tenant_id, task_id, input_hash) values
  ('c6000000-0000-4000-8000-000000000099', '11111111-1111-4111-8111-111111111111',
    'c3000000-0000-4000-8000-000000000001', repeat('9', 64));

insert into public.task_authority_contracts (
  id, tenant_id, task_id, plan_id, spec_version, allowed_actions, ephemeral_limits, contract_status,
  registry_version, compiler_version, input_hash, output_hash, data_flow_bindings, required_approvals, required_approvals_spec
) values (
  'c4000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
  'c3000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000099', 'v1', '{"schemaVersion":1,"items":[]}',
  '{"schemaVersion":1,"maxToolInvocations":5,"expiresInSeconds":60}', 'active',
  'fixture-registry', 'fixture-compiler', repeat('a', 64), repeat('b', 64),
  '{"schemaVersion":1,"refs":[]}', '{"schemaVersion":1,"items":[]}', '{"schemaVersion":1,"items":[]}'
);

insert into public.tool_requests (
  id, tenant_id, task_id, agent_id, tool, operation, normalized_arguments, idempotency_key
) values (
  'c5000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
  'c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001',
  'github.read_issue', 'read_issue', '{"schemaVersion":1,"values":{}}', 'fixture-key-c1'
);

insert into public.authorization_decisions (
  id, tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome,
  reason_codes, applied_constraints, latency_ms
) values (
  'c6000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
  'c3000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001',
  'c4000000-0000-4000-8000-000000000001', 1, 'allow',
  '{"schemaVersion":1,"items":[]}', '{"schemaVersion":1,"items":[]}', 1
);

insert into public.execution_events (id, tenant_id, task_id, event_type, result_status, summary) values (
  'c7000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
  'c3000000-0000-4000-8000-000000000001', 'task_received', 'info', 'Fixture event C'
);

insert into public.policies (id, tenant_id, name, effect, status, activated_at) values (
  'c8000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
  'Fixture Active Policy C', 'deny', 'active', now()
);

insert into public.policies (id, tenant_id, name, effect, status) values (
  'c9000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
  'Fixture Draft Policy C', 'deny', 'draft'
);

-- ---------------------------------------------------------------------
-- Role-gated writes.
-- ---------------------------------------------------------------------

set local role authenticated;

-- Viewer: read-only everywhere. Attempting to create an agent must fail.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}';

select t(throws_ok(
  $$ insert into public.agents (tenant_id, name, model_provider, model, framework, owner_principal_id, status)
     values ('11111111-1111-4111-8111-111111111111', 'viewer-agent', 'openai', 'gpt', 'x',
             'c1000000-0000-4000-8000-000000000001', 'active') $$,
  '42501', null,
  'viewer cannot create an agent'));

-- Developer: appropriate writes succeed.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';

select t(lives_ok(
  $$ insert into public.agents (tenant_id, name, model_provider, model, framework, owner_principal_id, status)
     values ('11111111-1111-4111-8111-111111111111', 'dev-created-fixture-agent', 'openai', 'gpt', 'x',
             'c1000000-0000-4000-8000-000000000001', 'active') $$,
  'developer can create an agent in their own tenant'));

select t(throws_ok(
  $$ insert into public.integrations (tenant_id, provider, display_name)
     values ('11111111-1111-4111-8111-111111111111', 'stripe', 'Dev attempt') $$,
  '42501', null,
  'developer cannot create an integration — admin+ only'));

-- Same RLS shape as the "already-active" case below: the developer holds
-- UPDATE privilege on the table (granted broadly to `authenticated`), so
-- RLS matches zero rows rather than raising. The proof is that the policy
-- is still a draft afterward.
update public.policies set status = 'active'
  where id = 'c9000000-0000-4000-8000-000000000001';

select t(is(
  (select status::text from public.policies where id = 'c9000000-0000-4000-8000-000000000001'),
  'draft',
  'developer cannot activate a policy — security_admin+ only'));

-- Security administrator: policy actions.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
-- admin.a's rank (40) exceeds security_admin (30), so has_min_role('security_admin')
-- holds for admin too — the same "higher subsumes lower" rule Part 2A's
-- membership hierarchy already uses.

select t(lives_ok(
  $$ update public.policies set description = 'edited while draft'
     where id = 'c9000000-0000-4000-8000-000000000001' $$,
  'security_admin-and-above can edit a draft policy'));

-- RLS matches zero rows rather than raising (USING requires status = 'draft'
-- on the row being touched), so the proof is that the row is unchanged when
-- read back afterward.
update public.policies set description = 'trying to edit active'
  where id = 'c8000000-0000-4000-8000-000000000001';

select t(is(
  (select description from public.policies where id = 'c8000000-0000-4000-8000-000000000001'),
  null,
  'security_admin-and-above cannot edit an already-active policy — RLS blocks it before the trigger'));

select t(throws_ok(
  $$ insert into public.approvals (tenant_id, task_id, authorization_decision_id, requested_from_principal_id, summary)
     values ('11111111-1111-4111-8111-111111111111', 'c3000000-0000-4000-8000-000000000001',
             'c6000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'test') $$,
  '42501', null,
  'no authenticated role holds INSERT on approvals — not even security_admin+'));

-- Admin: integration management.
select t(lives_ok(
  $$ insert into public.integrations (tenant_id, provider, display_name)
     values ('11111111-1111-4111-8111-111111111111', 'salesforce', 'Admin-created integration') $$,
  'admin can create integration metadata'));

-- ---------------------------------------------------------------------
-- Capabilities: no authenticated role can mint one by inserting a row.
-- ---------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
-- Owner — the highest rank there is — attempting the same insert.

select t(throws_ok(
  $$ insert into public.capabilities (
       tenant_id, task_id, authorization_decision_id, agent_id, tool, max_invocations, expires_at
     )
     values ('11111111-1111-4111-8111-111111111111', 'c3000000-0000-4000-8000-000000000001',
             'c6000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001',
             'github.read_issue', 1, now() + interval '1 hour') $$,
  '42501', null,
  'even the tenant owner cannot mint a capability by inserting a row'));

-- ---------------------------------------------------------------------
-- Append-only and immutability, exercised as a superuser — the strongest
-- possible role, so a pass here means the guarantee holds for literally
-- every authenticated actor.
-- ---------------------------------------------------------------------

reset role;

select t(throws_ok(
  $$ update public.authorization_decisions set outcome = 'deny'
     where id = 'c6000000-0000-4000-8000-000000000001' $$,
  '23514', 'rows in authorization_decisions are append-only and cannot be updated or deleted',
  'an authorization decision cannot be updated, even by a superuser'));

select t(throws_ok(
  $$ delete from public.authorization_decisions where id = 'c6000000-0000-4000-8000-000000000001' $$,
  '23514', 'rows in authorization_decisions are append-only and cannot be updated or deleted',
  'an authorization decision cannot be deleted, even by a superuser'));

select t(throws_ok(
  $$ update public.execution_events set summary = 'tampered'
     where id = 'c7000000-0000-4000-8000-000000000001' $$,
  '23514', 'rows in execution_events are append-only and cannot be updated or deleted',
  'an execution event cannot be updated, even by a superuser'));

select t(throws_ok(
  $$ delete from public.execution_events where id = 'c7000000-0000-4000-8000-000000000001' $$,
  '23514', 'rows in execution_events are append-only and cannot be updated or deleted',
  'an execution event cannot be deleted, even by a superuser'));

select t(throws_ok(
  $$ update public.task_authority_contracts set spec_version = 'v2'
     where id = 'c4000000-0000-4000-8000-000000000001' $$,
  '23514', 'a task authority contract is immutable; create a new version instead',
  'an active contract is immutable, even to a superuser'));

select t(throws_ok(
  $$ update public.policies set description = 'tampered'
     where id = 'c8000000-0000-4000-8000-000000000001' $$,
  '23514', 'an active policy version is immutable; create a new version instead',
  'an active policy is immutable, even to a superuser'));

-- A draft policy remains editable by a superuser, confirming the trigger's
-- condition is status-based, not a blanket lock on the table.
select t(lives_ok(
  $$ update public.policies set description = 'superuser can still edit drafts'
     where id = 'c9000000-0000-4000-8000-000000000001' $$,
  'a draft policy is not blocked by the immutability trigger'));

select t(throws_ok(
  $$ update public.tasks set tenant_id = '22222222-2222-4222-8222-222222222222'
     where id = 'c3000000-0000-4000-8000-000000000001' $$,
  '23503', null,
  'a task cannot be reassigned to a tenant its agent/principal don''t belong to'));
