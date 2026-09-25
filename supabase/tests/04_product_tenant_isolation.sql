-- Part 2B.1: tenant isolation for the product schema.
--
-- Fixtures are created fresh inside this suite's own transaction (as
-- postgres, which bypasses RLS for setup) and are gone once the harness
-- rolls the transaction back — nothing here depends on, or leaves behind,
-- any state from the demo installer or seed.sql beyond the two tenants and
-- five users seed.sql already provides.

select plan(22);

-- Setup ---------------------------------------------------------------

insert into public.principals (id, tenant_id, kind, display_name) values
  ('a1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human', 'Test Principal A'),
  ('b1000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'human', 'Test Principal B');

insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('a2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'agent-a', 'openai', 'gpt', 'x',
    'a1000000-0000-4000-8000-000000000001', 'active'),
  ('b2000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'agent-b', 'openai', 'gpt', 'x',
    'b1000000-0000-4000-8000-000000000001', 'active');

insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('a3000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
    'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Test task A', 'pending'),
  ('b3000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
    'b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Test task B', 'pending');

insert into public.policies (id, tenant_id, name, effect, status) values
  ('a4000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Test Policy A', 'deny', 'active');

insert into public.integrations (id, tenant_id, provider, display_name) values
  ('a5000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'salesforce', 'Test Integration A');

insert into public.plans (id, tenant_id, task_id, input_hash) values
  ('a6000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000001', repeat('9', 64));

-- ---------------------------------------------------------------------
-- Unauthenticated access: anon holds no privilege on any of these tables,
-- so access fails before RLS is even consulted.
-- ---------------------------------------------------------------------

select t(throws_ok(
  $$ set local role anon; select count(*) from public.principals $$, '42501', null,
  'anon denied on principals'));
select t(throws_ok(
  $$ set local role anon; select count(*) from public.agents $$, '42501', null,
  'anon denied on agents'));
select t(throws_ok(
  $$ set local role anon; select count(*) from public.tasks $$, '42501', null,
  'anon denied on tasks'));
select t(throws_ok(
  $$ set local role anon; select count(*) from public.task_authority_contracts $$, '42501', null,
  'anon denied on task_authority_contracts'));
select t(throws_ok(
  $$ set local role anon; select count(*) from public.plans $$, '42501', null,
  'anon denied on plans'));
select t(throws_ok(
  $$ set local role anon; select count(*) from public.plan_nodes $$, '42501', null,
  'anon denied on plan_nodes'));
select t(throws_ok(
  $$ set local role anon; select count(*) from public.tool_requests $$, '42501', null,
  'anon denied on tool_requests'));
select t(throws_ok(
  $$ set local role anon; select count(*) from public.semantic_decisions $$, '42501', null,
  'anon denied on semantic_decisions'));
select t(throws_ok(
  $$ set local role anon; select count(*) from public.authorization_decisions $$, '42501', null,
  'anon denied on authorization_decisions'));
select t(throws_ok(
  $$ set local role anon; select count(*) from public.capabilities $$, '42501', null,
  'anon denied on capabilities'));
select t(throws_ok(
  $$ set local role anon; select count(*) from public.approvals $$, '42501', null,
  'anon denied on approvals'));
select t(throws_ok(
  $$ set local role anon; select count(*) from public.execution_events $$, '42501', null,
  'anon denied on execution_events'));
select t(throws_ok(
  $$ set local role anon; select count(*) from public.policies $$, '42501', null,
  'anon denied on policies'));
select t(throws_ok(
  $$ set local role anon; select count(*) from public.integrations $$, '42501', null,
  'anon denied on integrations'));

-- ---------------------------------------------------------------------
-- Cross-tenant reads, as a real authenticated member of tenant A.
-- ---------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

select t(is(
  (select count(*) from public.agents where id = 'b2000000-0000-4000-8000-000000000001')::int, 0,
  'tenant A cannot read tenant B''s agent'));
select t(is(
  (select count(*) from public.tasks where id = 'b3000000-0000-4000-8000-000000000001')::int, 0,
  'tenant A cannot read tenant B''s task'));
select t(is(
  (select count(*) from public.principals where id = 'b1000000-0000-4000-8000-000000000001')::int, 0,
  'tenant A cannot read tenant B''s principal'));

-- Positive control: isolation isn't achieved by denying everything.
select t(is(
  (select count(*) from public.agents where id = 'a2000000-0000-4000-8000-000000000001')::int, 1,
  'tenant A can read its own agent'));

-- ---------------------------------------------------------------------
-- Cross-tenant insert attempts.
-- ---------------------------------------------------------------------

-- dev.a (tenant A developer) tries to insert an agent *for tenant B*. The
-- WITH CHECK clause evaluates has_min_role(tenant_id, 'developer') against
-- the row's own tenant_id — B — where dev.a holds no membership at all.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';

select t(throws_ok(
  $$ insert into public.agents (tenant_id, name, model_provider, model, framework, owner_principal_id, status)
     values ('22222222-2222-4222-8222-222222222222', 'sneaky', 'openai', 'gpt', 'x',
             'b1000000-0000-4000-8000-000000000001', 'active') $$,
  '42501', null,
  'tenant A''s developer cannot insert an agent for tenant B'));

-- ---------------------------------------------------------------------
-- Cross-tenant parent references: the composite FK, exercised as a
-- superuser so the failure is provably a constraint, not merely a policy a
-- more privileged role might sidestep.
-- ---------------------------------------------------------------------

reset role;

select t(throws_ok(
  $$ insert into public.agents (tenant_id, name, model_provider, model, framework, owner_principal_id, status)
     values ('11111111-1111-4111-8111-111111111111', 'cross-tenant-owner', 'openai', 'gpt', 'x',
             'b1000000-0000-4000-8000-000000000001', 'active') $$,
  '23503', null,
  'an agent cannot reference an owner principal from another tenant'));

select t(throws_ok(
  $$ insert into public.tasks (tenant_id, agent_id, principal_id, intent, status)
     values ('11111111-1111-4111-8111-111111111111', 'b2000000-0000-4000-8000-000000000001',
             'a1000000-0000-4000-8000-000000000001', 'cross-tenant agent', 'pending') $$,
  '23503', null,
  'a task cannot reference an agent from another tenant'));

select t(throws_ok(
  $$ insert into public.task_authority_contracts (
       tenant_id, task_id, plan_id, spec_version, allowed_actions, ephemeral_limits,
       registry_version, compiler_version, input_hash, output_hash, data_flow_bindings, required_approvals, required_approvals_spec
     )
     values ('11111111-1111-4111-8111-111111111111', 'b3000000-0000-4000-8000-000000000001',
             'a6000000-0000-4000-8000-000000000001', 'v1',
             '{"schemaVersion":1,"items":[]}', '{"schemaVersion":1,"maxToolInvocations":1,"expiresInSeconds":1}',
             'fixture-registry', 'fixture-compiler', repeat('a', 64), repeat('b', 64),
             '{"schemaVersion":1,"refs":[]}', '{"schemaVersion":1,"items":[]}', '{"schemaVersion":1,"items":[]}') $$,
  '23503', null,
  'a contract cannot reference a task from another tenant'));
