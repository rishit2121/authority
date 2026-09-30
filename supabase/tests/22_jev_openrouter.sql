-- Jev/OpenRouter (TypeSafe Jev via OpenRouter): jev_settings, jev_necessity_evaluations,
-- jev_plan_completeness_evaluations and jev_risk_evaluations — RLS, append-only, cross-tenant isolation,
-- role gating and grant-shape checks against the real deployed schema. See docs/jev/OVERVIEW.md.

select plan(49);

set local role postgres;

insert into public.principals (id, tenant_id, kind, display_name, user_id) values
  ('22000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Owner (owner.a)', 'a0000000-0000-4000-8000-000000000001'),
  ('22000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Admin (admin.a)', 'a0000000-0000-4000-8000-000000000002'),
  ('22000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Developer (dev.a)', 'a0000000-0000-4000-8000-000000000003'),
  ('22000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Viewer (viewer.a)', 'a0000000-0000-4000-8000-000000000004'),
  ('22000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'human', 'Fixture Owner (owner.b)', 'b0000000-0000-4000-8000-000000000001');

insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('22000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'agent-22a', 'openai', 'gpt', 'x', '22000000-0000-4000-8000-000000000003', 'active'),
  ('22000000-0000-4000-8000-0000000000b2', '22222222-2222-4222-8222-222222222222', 'agent-22b', 'openai', 'gpt', 'x', '22000000-0000-4000-8000-0000000000b1', 'active');

insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('22000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', '22000000-0000-4000-8000-000000000005', '22000000-0000-4000-8000-000000000003', 'Task A for jev fixture', 'contract_issued'),
  ('22000000-0000-4000-8000-0000000000b3', '22222222-2222-4222-8222-222222222222', '22000000-0000-4000-8000-0000000000b2', '22000000-0000-4000-8000-0000000000b1', 'Task B for jev fixture', 'contract_issued');

insert into public.plans (id, tenant_id, task_id, version, input_hash) values
  ('22000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', '22000000-0000-4000-8000-000000000006', 1, repeat('7', 64)),
  ('22000000-0000-4000-8000-0000000000b4', '22222222-2222-4222-8222-222222222222', '22000000-0000-4000-8000-0000000000b3', 1, repeat('7', 64));

-- Minimal direct contract activation, mirroring suite 19's t19_activate — only what's needed to make
-- gateway.commit_authorization() produce a real tool_request/authorization_decision row per tenant.
create function public.t22_activate(p_task uuid, p_tenant uuid, p_id uuid, p_actions jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.task_authority_contracts (
    id, tenant_id, task_id, version, spec_version, allowed_actions, forbidden_resources, forbidden_operations,
    ephemeral_limits, contract_status, registry_version, compiler_version, input_hash, output_hash,
    data_flow_bindings, required_approvals, activated_at, expires_at, required_approvals_spec, demo_key)
  values (p_id, p_tenant, p_task, 1, 'v1', p_actions, '{}', '{}',
    jsonb_build_object('schemaVersion', 1, 'maxToolInvocations', 40, 'expiresInSeconds', 3600),
    'active', 'rv1', 'cv1', repeat('9', 64), repeat('8', 64), '{"schemaVersion":1,"refs":[]}'::jsonb,
    '{"schemaVersion":1,"items":[]}'::jsonb, now(), now() + interval '1 hour', '{"schemaVersion":1,"items":[]}'::jsonb,
    'test22:' || p_id::text)
$$;

select public.t22_activate('22000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111',
  '22000000-0000-4000-8000-0000000000c1', '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}'::jsonb);
select public.t22_activate('22000000-0000-4000-8000-0000000000b3', '22222222-2222-4222-8222-222222222222',
  '22000000-0000-4000-8000-0000000000c2', '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}'::jsonb);

-- Suite 19 neutralizes the connector predicate for the same reason (github.get_issue is connector-executed since
-- Part 7); only commit_authorization's decision/tool_request rows are needed here, never simulated consumption.
create or replace function gateway.is_connector_tool(p_tool text) returns boolean
language sql immutable set search_path = '' as $$ select false; $$;

create function public.t22_commit(p_secret text, p_task uuid, p_key text)
returns table (tool_request_id uuid, decision_id uuid, final_decision_id uuid)
language sql security definer set search_path = '' as $$
  select c.r_tool_request_id, c.r_decision_id, c.r_final_decision_id
  from gateway.commit_authorization(
    p_secret, p_task, 'github.get_issue', 'op', null, '{}'::jsonb,
    '{"schemaVersion":1,"count":0,"truncated":false,"entries":[]}'::jsonb, null, p_key, 'rv1', 'cv1', 'low', 1,
    encode(extensions.digest('authcap_v1_' || p_key, 'sha256'), 'hex'),
    null, null, null, null, null, null, null, null, null, null, null, null, 'gw-test22', false) c
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select set_config('test.secret_a', r.plaintext_secret, true) from public.create_agent_credential('22000000-0000-4000-8000-000000000005'::uuid) r;
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.secret_b', r.plaintext_secret, true) from public.create_agent_credential('22000000-0000-4000-8000-0000000000b2'::uuid) r;
set local role postgres;

select set_config('test.a_tool_request', c.tool_request_id::text, true), set_config('test.a_decision', c.decision_id::text, true),
  set_config('test.a_final', c.final_decision_id::text, true)
from public.t22_commit(current_setting('test.secret_a'), '22000000-0000-4000-8000-000000000006', 'r-a-1') c;

-- A separate, later statement (not a subquery correlated against commit_authorization's own output within the
-- same statement, which cannot see that call's own just-committed row — same-statement reads share one snapshot).
select set_config('test.a_agent', agent_id::text, true)
from public.tool_requests where id = current_setting('test.a_tool_request')::uuid;

select set_config('test.b_tool_request', c.tool_request_id::text, true), set_config('test.b_decision', c.decision_id::text, true)
from public.t22_commit(current_setting('test.secret_b'), '22000000-0000-4000-8000-0000000000b3', 'r-b-1') c;

-- =====================================================================
-- 0. Schema shape: RLS enabled, no unconditional policy, expected grants only.
-- =====================================================================
select t(is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in
     ('jev_settings', 'jev_necessity_evaluations', 'jev_plan_completeness_evaluations', 'jev_risk_evaluations')
     and c.relrowsecurity),
  4, 'all four Jev tables have row level security enabled'));

select t(is(
  (select count(*)::int from pg_policies where schemaname = 'public'
   and tablename in ('jev_settings', 'jev_necessity_evaluations', 'jev_plan_completeness_evaluations', 'jev_risk_evaluations')
   and (qual = 'true' or with_check = 'true')),
  0, 'no Jev table policy is unconditional (using(true) or with_check(true))'));

select t(is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'
   and table_name in ('jev_settings', 'jev_necessity_evaluations', 'jev_plan_completeness_evaluations', 'jev_risk_evaluations')),
  0, 'anon holds no privilege on any Jev table'));

select t(is(
  (select array_agg(distinct privilege_type::text order by privilege_type::text) from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated'
   and table_name in ('jev_settings', 'jev_necessity_evaluations', 'jev_plan_completeness_evaluations', 'jev_risk_evaluations')),
  array['SELECT'], 'authenticated holds SELECT only on every Jev table (all writes go through SECURITY DEFINER functions)'));

select t(is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authority_gateway'
   and table_name in ('jev_settings', 'jev_necessity_evaluations', 'jev_plan_completeness_evaluations', 'jev_risk_evaluations')),
  0, 'the gateway role holds no direct table privilege on any Jev table — writes only through the SECURITY DEFINER function it can execute'));

select t(is(
  (select count(*)::int from information_schema.role_routine_grants
   where routine_schema = 'gateway' and routine_name = 'record_jev_risk_evaluation' and grantee = 'authority_gateway'),
  1, 'the gateway role can execute gateway.record_jev_risk_evaluation'));

-- =====================================================================
-- 1. jev_settings: role gating, mode validation, RLS tenant isolation.
-- =====================================================================
set local role anon;
select t(throws_ok($$ select * from public.jev_settings $$, '42501', null, 'anon cannot read jev_settings'));
select t(throws_ok($$ select public.set_jev_settings('11111111-1111-4111-8111-111111111111'::uuid, 'shadow', 'off', false) $$,
  '42501', null, 'anon cannot call set_jev_settings'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}';
select t(throws_ok($$ select public.set_jev_settings('11111111-1111-4111-8111-111111111111'::uuid, 'shadow', 'off', false) $$,
  '42501', null, 'a viewer cannot change jev settings'));

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(throws_ok($$ select public.set_jev_settings('11111111-1111-4111-8111-111111111111'::uuid, 'shadow', 'off', false) $$,
  '42501', null, 'a developer cannot change jev settings (security_admin+ required)'));

set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(throws_ok($$ select public.set_jev_settings('11111111-1111-4111-8111-111111111111'::uuid, 'shadow', 'off', false) $$,
  'P0002', null, 'a member of a different tenant cannot change tenant A''s jev settings'));

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select t(throws_ok($$ select public.set_jev_settings('11111111-1111-4111-8111-111111111111'::uuid, 'bogus', 'off', false) $$,
  '22023', null, 'an invalid necessity mode is rejected'));
select t(throws_ok($$ select public.set_jev_settings('11111111-1111-4111-8111-111111111111'::uuid, 'shadow', 'enforce', false) $$,
  '22023', null, 'risk_mode has no enforce value in this schema yet — rejected'));
select t(throws_ok($$ select public.set_jev_settings('11111111-1111-4111-8111-111111111111'::uuid, 'enforce', 'off', false) $$,
  '22023', null, 'necessity enforce mode requires explicit approval'));

select t(is(
  (select row(necessity_mode, risk_mode) from public.set_jev_settings('11111111-1111-4111-8111-111111111111'::uuid, 'shadow', 'shadow', false)),
  row('shadow'::text, 'shadow'::text), 'admin.a (security_admin+) can set necessity/risk to shadow'));

select t(is(
  (select row(necessity_mode, risk_mode) from public.set_jev_settings('11111111-1111-4111-8111-111111111111'::uuid, 'enforce', 'shadow', true)),
  row('enforce'::text, 'shadow'::text), 'necessity enforce succeeds once explicitly approved'));

select t(is(
  (select enforcement_approved_at is not null from public.jev_settings where tenant_id = '11111111-1111-4111-8111-111111111111'),
  true, 'enforcement_approved_at is recorded once approved'));

-- Tenant isolation: owner.b cannot see tenant A's settings row, and cannot write it either.
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(is(
  (select count(*)::int from public.jev_settings where tenant_id = '11111111-1111-4111-8111-111111111111'),
  0, 'tenant B cannot see tenant A''s jev_settings row (RLS)'));
select t(throws_ok($$ insert into public.jev_settings (tenant_id, necessity_mode) values ('22222222-2222-4222-8222-222222222222', 'shadow') $$,
  '42501', null, 'no client can write jev_settings directly by inserting a row'));
select t(throws_ok($$ update public.jev_settings set necessity_mode = 'off' where tenant_id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'no client can write jev_settings directly by updating a row'));

set local role postgres;
select t(is(
  (select count(*)::int from public.jev_settings where tenant_id = '11111111-1111-4111-8111-111111111111'),
  1, 'exactly one settings row exists for tenant A (upsert, not a new row per call)'));

-- =====================================================================
-- 2. jev_necessity_evaluations: role gating, cross-tenant FK rejection, append-only, RLS isolation.
-- =====================================================================
set local role anon;
select t(throws_ok($$ select * from public.jev_necessity_evaluations $$, '42501', null, 'anon cannot read jev_necessity_evaluations'));
select t(throws_ok($$ select public.record_jev_necessity_evaluation('11111111-1111-4111-8111-111111111111'::uuid, '{}'::jsonb) $$,
  '42501', null, 'anon cannot call record_jev_necessity_evaluation'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}';
select t(throws_ok($$ select public.record_jev_necessity_evaluation('11111111-1111-4111-8111-111111111111'::uuid, jsonb_build_object(
    'taskId', '22000000-0000-4000-8000-000000000006', 'planId', '22000000-0000-4000-8000-000000000007',
    'nodeKey', 'n1', 'tool', 'github.get_issue', 'registryVersion', 'rv1', 'compilerVersion', 'cv1', 'mode', 'shadow',
    'provider', 'mock', 'model', 'm', 'modelVersion', 'v1', 'inputHash', repeat('a', 64), 'state', 'ok',
    'result', jsonb_build_object('schemaVersion', 1, 'classification', 'required', 'confidence', 0.5, 'reasonCodes', '[]'::jsonb,
      'requiredPredecessorNodeIds', '[]'::jsonb, 'missingInformationCodes', '[]'::jsonb, 'alternativeOperationIds', '[]'::jsonb),
    'mechanicalStatus', 'accepted', 'finalStatus', 'accepted', 'disagreement', false, 'latencyMs', 100)) $$,
  '42501', null, 'a viewer cannot record a necessity evaluation (developer+ required)'));

set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(throws_ok($$ select public.record_jev_necessity_evaluation('11111111-1111-4111-8111-111111111111'::uuid, '{}'::jsonb) $$,
  'P0002', null, 'a member of a different tenant cannot record into tenant A at all'));

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(throws_ok($$ select public.record_jev_necessity_evaluation('11111111-1111-4111-8111-111111111111'::uuid, jsonb_build_object(
    'taskId', '22000000-0000-4000-8000-0000000000b3', 'planId', '22000000-0000-4000-8000-000000000007',
    'nodeKey', 'n1', 'tool', 'github.get_issue', 'registryVersion', 'rv1', 'compilerVersion', 'cv1', 'mode', 'shadow',
    'provider', 'mock', 'model', 'm', 'modelVersion', 'v1', 'inputHash', repeat('a', 64), 'state', 'ok', 'result', null,
    'mechanicalStatus', 'accepted', 'finalStatus', 'accepted', 'disagreement', false, 'latencyMs', 100)) $$,
  '23503', null, 'referencing tenant B''s task under tenant A''s id is rejected (cross-tenant FK integrity)'));

select t(is(
  (select public.record_jev_necessity_evaluation('11111111-1111-4111-8111-111111111111'::uuid, jsonb_build_object(
    'taskId', '22000000-0000-4000-8000-000000000006', 'planId', '22000000-0000-4000-8000-000000000007',
    'nodeKey', 'n1', 'tool', 'github.get_issue', 'registryVersion', 'rv1', 'compilerVersion', 'cv1', 'mode', 'shadow',
    'provider', 'mock', 'model', 'm', 'modelVersion', 'v1', 'inputHash', repeat('a', 64), 'state', 'ok',
    'result', jsonb_build_object('schemaVersion', 1, 'classification', 'required', 'confidence', 0.5, 'reasonCodes', '[]'::jsonb,
      'requiredPredecessorNodeIds', '[]'::jsonb, 'missingInformationCodes', '[]'::jsonb, 'alternativeOperationIds', '[]'::jsonb),
    'mechanicalStatus', 'accepted', 'finalStatus', 'accepted', 'disagreement', false, 'latencyMs', 100)) is not null),
  true, 'dev.a (developer, in-tenant, valid references) can record a necessity evaluation'));

select set_config('test.nec_1', (select id::text from public.jev_necessity_evaluations
  where tenant_id = '11111111-1111-4111-8111-111111111111' and node_key = 'n1'), true);

set local role postgres;
select t(throws_ok(
  format($$ update public.jev_necessity_evaluations set final_status = 'denied' where id = %L $$, current_setting('test.nec_1')),
  '23514', null, 'a necessity evaluation cannot be updated (append-only)'));
select t(throws_ok(
  format($$ delete from public.jev_necessity_evaluations where id = %L $$, current_setting('test.nec_1')),
  '23514', null, 'a necessity evaluation cannot be deleted (append-only)'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(is(
  (select count(*)::int from public.jev_necessity_evaluations where id = current_setting('test.nec_1')::uuid),
  0, 'tenant B cannot see tenant A''s necessity evaluation (RLS)'));
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(is(
  (select count(*)::int from public.jev_necessity_evaluations where id = current_setting('test.nec_1')::uuid),
  1, 'tenant A''s owner can see tenant A''s own necessity evaluation'));

-- =====================================================================
-- 3. jev_plan_completeness_evaluations: same role/isolation/append-only shape, lighter coverage.
-- =====================================================================
set local role anon;
select t(throws_ok($$ select * from public.jev_plan_completeness_evaluations $$, '42501', null, 'anon cannot read jev_plan_completeness_evaluations'));
select t(throws_ok($$ select public.record_jev_completeness_evaluation('11111111-1111-4111-8111-111111111111'::uuid, '{}'::jsonb) $$,
  '42501', null, 'anon cannot call record_jev_completeness_evaluation'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}';
select t(throws_ok($$ select public.record_jev_completeness_evaluation('11111111-1111-4111-8111-111111111111'::uuid, jsonb_build_object(
    'taskId', '22000000-0000-4000-8000-000000000006', 'planId', '22000000-0000-4000-8000-000000000007',
    'provider', 'mock', 'model', 'm', 'modelVersion', 'v1', 'inputHash', repeat('b', 64), 'state', 'ok',
    'result', jsonb_build_object('schemaVersion', 1, 'classification', 'complete', 'confidence', 0.5, 'possibleMissingOperationIds', '[]'::jsonb),
    'latencyMs', 100)) $$,
  '42501', null, 'a viewer cannot record a completeness evaluation (developer+ required)'));

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(throws_ok($$ select public.record_jev_completeness_evaluation('11111111-1111-4111-8111-111111111111'::uuid, jsonb_build_object(
    'taskId', '22000000-0000-4000-8000-0000000000b3', 'planId', '22000000-0000-4000-8000-000000000007',
    'provider', 'mock', 'model', 'm', 'modelVersion', 'v1', 'inputHash', repeat('b', 64), 'state', 'ok', 'result', null,
    'latencyMs', 100)) $$,
  '23503', null, 'referencing tenant B''s task under tenant A''s id is rejected (cross-tenant FK integrity)'));

select t(is(
  (select public.record_jev_completeness_evaluation('11111111-1111-4111-8111-111111111111'::uuid, jsonb_build_object(
    'taskId', '22000000-0000-4000-8000-000000000006', 'planId', '22000000-0000-4000-8000-000000000007',
    'provider', 'mock', 'model', 'm', 'modelVersion', 'v1', 'inputHash', repeat('b', 64), 'state', 'ok',
    'result', jsonb_build_object('schemaVersion', 1, 'classification', 'complete', 'confidence', 0.5, 'possibleMissingOperationIds', '[]'::jsonb),
    'latencyMs', 100)) is not null),
  true, 'dev.a can record a plan-completeness evaluation'));

select set_config('test.comp_1', (select id::text from public.jev_plan_completeness_evaluations
  where tenant_id = '11111111-1111-4111-8111-111111111111'), true);

set local role postgres;
select t(throws_ok(
  format($$ update public.jev_plan_completeness_evaluations set state = 'error' where id = %L $$, current_setting('test.comp_1')),
  '23514', null, 'a completeness evaluation cannot be updated (append-only)'));
select t(throws_ok(
  format($$ delete from public.jev_plan_completeness_evaluations where id = %L $$, current_setting('test.comp_1')),
  '23514', null, 'a completeness evaluation cannot be deleted (append-only)'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(is(
  (select count(*)::int from public.jev_plan_completeness_evaluations where id = current_setting('test.comp_1')::uuid),
  0, 'tenant B cannot see tenant A''s completeness evaluation (RLS)'));

-- =====================================================================
-- 4. jev_risk_evaluations: gateway-role-only writes, agent_id resolved server-side, cross-tenant lookup
--    rejection, append-only, RLS isolation.
-- =====================================================================
set local role anon;
select t(throws_ok($$ select * from public.jev_risk_evaluations $$, '42501', null, 'anon cannot read jev_risk_evaluations'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(throws_ok(
  format($$ select gateway.record_jev_risk_evaluation('11111111-1111-4111-8111-111111111111'::uuid, jsonb_build_object(
    'taskId', '22000000-0000-4000-8000-000000000006', 'toolRequestId', %L, 'authorizationDecisionId', %L,
    'provider', 'mock', 'model', 'm', 'modelVersion', 'v1', 'inputHash', repeat('c', 64), 'state', 'ok',
    'result', jsonb_build_object('schemaVersion', 1, 'riskClass', 'low', 'confidence', 0.5, 'categories', '["none"]'::jsonb, 'evidenceCodes', '[]'::jsonb),
    'deterministicDecision', 'allow', 'finalDecision', 'allow', 'disagreement', false, 'latencyMs', 50)) $$,
    current_setting('test.a_tool_request'), current_setting('test.a_decision')),
  '42501', null, 'even a tenant owner cannot call the gateway-only record_jev_risk_evaluation'));

-- pgTAP's own functions live in a schema the gateway role deliberately cannot use (mirrors suite 19's exact
-- pattern), so its attempts are captured via set_config here and asserted as the table owner afterwards.
set local role authority_gateway;
do $$
begin
  perform gateway.record_jev_risk_evaluation('11111111-1111-4111-8111-111111111111'::uuid, jsonb_build_object(
    'taskId', '22000000-0000-4000-8000-000000000006', 'toolRequestId', current_setting('test.a_tool_request'),
    'authorizationDecisionId', current_setting('test.a_decision'),
    'provider', 'mock', 'model', 'm', 'modelVersion', 'v1', 'inputHash', repeat('c', 64), 'state', 'ok',
    'result', jsonb_build_object('schemaVersion', 1, 'riskClass', 'low', 'confidence', 0.5, 'categories', '["none"]'::jsonb, 'evidenceCodes', '[]'::jsonb),
    'deterministicDecision', 'allow', 'finalDecision', 'allow', 'disagreement', false, 'latencyMs', 50));
  perform set_config('t22.risk_insert', 'ok', true);
exception when others then
  perform set_config('t22.risk_insert', sqlstate, true);
end $$;

-- Cross-tenant lookup rejection: tenant A's own toolRequestId does not belong to tenant B.
do $$
begin
  perform gateway.record_jev_risk_evaluation('22222222-2222-4222-8222-222222222222'::uuid, jsonb_build_object(
    'taskId', '22000000-0000-4000-8000-0000000000b3', 'toolRequestId', current_setting('test.a_tool_request'),
    'authorizationDecisionId', current_setting('test.a_decision'),
    'provider', 'mock', 'model', 'm', 'modelVersion', 'v1', 'inputHash', repeat('d', 64), 'state', 'ok', 'result', null,
    'deterministicDecision', 'allow', 'finalDecision', 'allow', 'disagreement', false, 'latencyMs', 50));
  perform set_config('t22.risk_cross_tenant', 'ok', true);
exception when others then
  perform set_config('t22.risk_cross_tenant', sqlstate, true);
end $$;

set local role postgres;
select t(is(current_setting('t22.risk_insert'), 'ok',
  'the authority_gateway role can record a risk evaluation for a real decision it produced'));
select t(is(current_setting('t22.risk_cross_tenant'), 'P0002',
  'tenant B cannot record a risk evaluation against tenant A''s tool request (agent lookup filters by tenant)'));

select t(is(
  (select agent_id::text from public.jev_risk_evaluations where authorization_decision_id = current_setting('test.a_decision')::uuid),
  current_setting('test.a_agent'), 'agent_id is resolved server-side from the tool_request, matching the credential''s real agent'));

select t(throws_ok(
  format($$ update public.jev_risk_evaluations set state = 'error' where authorization_decision_id = %L $$, current_setting('test.a_decision')),
  '23514', null, 'a risk evaluation cannot be updated (append-only)'));
select t(throws_ok(
  format($$ delete from public.jev_risk_evaluations where authorization_decision_id = %L $$, current_setting('test.a_decision')),
  '23514', null, 'a risk evaluation cannot be deleted (append-only)'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(is(
  (select count(*)::int from public.jev_risk_evaluations where authorization_decision_id = current_setting('test.a_decision')::uuid),
  0, 'tenant B cannot see tenant A''s risk evaluation (RLS)'));
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(is(
  (select count(*)::int from public.jev_risk_evaluations where authorization_decision_id = current_setting('test.a_decision')::uuid),
  1, 'tenant A''s owner can see tenant A''s own risk evaluation'));

set local role postgres;
select t(is(
  (select gateway.record_jev_risk_evaluation('11111111-1111-4111-8111-111111111111'::uuid, jsonb_build_object(
    'taskId', '22000000-0000-4000-8000-000000000006', 'toolRequestId', current_setting('test.a_tool_request'),
    'authorizationDecisionId', current_setting('test.a_decision'),
    'provider', 'mock', 'model', 'm', 'modelVersion', 'v1', 'inputHash', repeat('e', 64), 'state', 'ok',
    'result', null, 'deterministicDecision', 'allow', 'finalDecision', 'allow', 'disagreement', false, 'latencyMs', 50))),
  null::uuid, 'a second call for the same decision is a no-op (unique authorization_decision_id, on conflict do nothing)'));
