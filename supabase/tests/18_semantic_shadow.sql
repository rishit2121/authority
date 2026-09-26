-- Part 5: semantic shadow evaluation — settings, evaluation context, recording,
-- evidence immutability, tenant/agent isolation, forged-evidence rejection,
-- and the Part 4 fix for failed-authentication auditing.

select plan(48);

set local role postgres;

insert into public.principals (id, tenant_id, kind, display_name, user_id) values
  ('18000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Owner (dev.a)', 'a0000000-0000-4000-8000-000000000003'),
  ('18000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Admin (owner.a)', 'a0000000-0000-4000-8000-000000000001'),
  ('18000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'human', 'Fixture Owner (owner.b)', 'b0000000-0000-4000-8000-000000000001');
insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('18000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'agent-18', 'openai', 'gpt', 'x', '18000000-0000-4000-8000-000000000001', 'active'),
  ('18000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', 'agent-18-other', 'openai', 'gpt', 'x', '18000000-0000-4000-8000-000000000001', 'active'),
  ('18000000-0000-4000-8000-0000000000b3', '22222222-2222-4222-8222-222222222222', 'agent-18-b', 'openai', 'gpt', 'x', '18000000-0000-4000-8000-0000000000b1', 'active');
insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('18000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '18000000-0000-4000-8000-000000000003', '18000000-0000-4000-8000-000000000001', 'Read issue 991 in payments-api', 'pending'),
  ('18000000-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111', '18000000-0000-4000-8000-000000000009', '18000000-0000-4000-8000-000000000001', 'Other agent task', 'pending');
insert into public.plans (id, tenant_id, task_id, version, input_hash) values
  ('18000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', '18000000-0000-4000-8000-000000000004', 1, repeat('6', 64));

-- Helper: one runtime call as agent A, returning the decision id.
create function public.t18_call(p_key text, p_secret_setting text default 'test.secret_a', p_task uuid default '18000000-0000-4000-8000-000000000004')
returns uuid language sql as $$
  select a.decision_id from public.authorize_tool_call(
    current_setting(p_secret_setting), p_task, 'github.get_issue', 'get_issue', null, '{}'::jsonb, null, p_key, null, 'rv1', 'cv1') a
$$;
grant execute on function public.t18_call(text, text, uuid) to anon;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';

select set_config('test.secret_a', r.plaintext_secret, true) from public.create_agent_credential('18000000-0000-4000-8000-000000000003'::uuid) r;
select set_config('test.secret_other', r.plaintext_secret, true) from public.create_agent_credential('18000000-0000-4000-8000-000000000009'::uuid) r;

select t(is((select was_created from public.propose_task_contract(
   '18000000-0000-4000-8000-000000000004'::uuid, '18000000-0000-4000-8000-000000000005'::uuid,
   '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}'::jsonb, '{}', '{}',
   '{"schemaVersion":1,"maxToolInvocations":50,"expiresInSeconds":3600}'::jsonb,
   '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb,
   'rv1', 'cv1', repeat('a', 64), repeat('b', 64),
   '{"schemaVersion":1,"ok":true,"checks":[]}'::jsonb, '{"schemaVersion":1}'::jsonb)),
  true, 'a contract is proposed for the semantic fixture task'));

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(lives_ok($$ select public.activate_task_contract((select id from public.task_authority_contracts where task_id = '18000000-0000-4000-8000-000000000004' and version = 1)) $$,
  'the contract activates'));

-- Tenant B credential (cross-tenant probes).
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.secret_b', r.plaintext_secret, true) from public.create_agent_credential('18000000-0000-4000-8000-0000000000b3'::uuid) r;

-- Decisions to attach evidence to (default semantic mode is off: no settings row yet).
set local role anon;
select set_config('test.dec_1', public.t18_call('s-1')::text, true);
select set_config('test.dec_2', public.t18_call('s-2')::text, true);
select set_config('test.dec_3', public.t18_call('s-3')::text, true);
select set_config('test.dec_4', public.t18_call('s-4')::text, true);
select set_config('test.dec_5', public.t18_call('s-5')::text, true);
select set_config('test.dec_6', public.t18_call('s-6')::text, true);
select set_config('test.dec_7', public.t18_call('s-7')::text, true);

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
select t(is((select ctx_mode::text from public.get_semantic_evaluation_context(current_setting('test.secret_a'), current_setting('test.dec_1')::uuid)),
  'off', 'with no settings row the semantic mode defaults to off'));

select t(throws_ok(
  $$ select public.record_semantic_shadow(current_setting('test.secret_a'), current_setting('test.dec_1')::uuid, 'mock', 'm', '1', 'ok',
       '{"schemaVersion":1,"taskAlignment":0.9,"resourceRelevance":0.9,"scopeExpansion":0.1,"externalDisclosure":0.1,"promptInjection":0.1,"suspiciousArgumentChange":0.1,"planDeviation":0.1}'::jsonb,
       '{}', 'low', 0.8, 5, repeat('a', 64), '{"schemaVersion":1}'::jsonb, null) $$,
  '55000', null, 'recording is refused while semantic mode is off'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(throws_ok($$ select public.set_semantic_settings('11111111-1111-4111-8111-111111111111'::uuid, 'shadow', 'mock', 'mock-heuristic', 500) $$,
  '42501', null, 'a developer cannot change semantic settings'));

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}';
select t(throws_ok($$ select public.set_semantic_settings('11111111-1111-4111-8111-111111111111'::uuid, 'shadow', 'mock', 'mock-heuristic', 500) $$,
  '42501', null, 'a viewer cannot change semantic settings'));

set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(throws_ok($$ select public.set_semantic_settings('11111111-1111-4111-8111-111111111111'::uuid, 'shadow', 'mock', 'mock-heuristic', 500) $$,
  '42501', null, 'a member of another tenant cannot change this tenant''s settings'));

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(throws_ok($$ select public.set_semantic_settings('11111111-1111-4111-8111-111111111111'::uuid, 'enforce', 'mock', 'mock-heuristic', 500) $$,
  '0A000', null, 'enforce mode is refused outright — enforcement is unavailable'));

select t(throws_ok($$ select public.set_semantic_settings('11111111-1111-4111-8111-111111111111'::uuid, 'shadow', 'mock', 'mock-heuristic', 50000) $$,
  '23514', null, 'an out-of-range timeout is refused by the table constraint'));

select t(throws_ok($$ select public.set_semantic_settings('11111111-1111-4111-8111-111111111111'::uuid, 'shadow', 'http://attacker', 'm', 500) $$,
  '23514', null, 'an unknown provider name is refused'));

select t(throws_ok($$ insert into public.semantic_settings (tenant_id, mode) values ('11111111-1111-4111-8111-111111111111', 'shadow') $$,
  '42501', null, 'a client cannot write settings directly, only through the RPC'));

select t(lives_ok($$ select public.set_semantic_settings('11111111-1111-4111-8111-111111111111'::uuid, 'shadow', 'mock', 'mock-heuristic', 500) $$,
  'an owner can enable shadow mode'));

select t(is((select count(*)::int from public.semantic_settings_audit where tenant_id = '11111111-1111-4111-8111-111111111111'), 1,
  'the settings change was audited'));

select t(is((select (new_settings ->> 'mode') from public.semantic_settings_audit where tenant_id = '11111111-1111-4111-8111-111111111111' limit 1),
  'shadow', 'the audit row records the new mode and no secret material (settings hold none)'));

set local role postgres;
select t(throws_ok($$ update public.semantic_settings set mode = 'enforce' where tenant_id = '11111111-1111-4111-8111-111111111111' $$,
  '23514', null, 'even the table owner cannot store enforce: a CHECK constraint forbids it'));

-- ---------------------------------------------------------------------
-- Evaluation context: derived from persisted rows, scoped to the credential
-- ---------------------------------------------------------------------
set local role anon;
select t(is((select ctx_mode::text from public.get_semantic_evaluation_context(current_setting('test.secret_a'), current_setting('test.dec_1')::uuid)),
  'shadow', 'the context reports the tenant''s shadow mode'));
select t(is((select ctx_task_intent from public.get_semantic_evaluation_context(current_setting('test.secret_a'), current_setting('test.dec_1')::uuid)),
  'Read issue 991 in payments-api', 'the trusted intent comes from the task row, not the caller'));
select t(is((select ctx_allowed_tools from public.get_semantic_evaluation_context(current_setting('test.secret_a'), current_setting('test.dec_1')::uuid)),
  array['github.get_issue'], 'allowed tools come from the decision''s contract'));
select t(is((select ctx_decision_outcome::text from public.get_semantic_evaluation_context(current_setting('test.secret_a'), current_setting('test.dec_1')::uuid)),
  'allow', 'the deterministic outcome is read from the persisted decision'));

select t(throws_ok($$ select * from public.get_semantic_evaluation_context('authority_rk_notarealsecret0000', current_setting('test.dec_1')::uuid) $$,
  '28000', null, 'an unknown credential cannot read context'));
select t(throws_ok($$ select * from public.get_semantic_evaluation_context(current_setting('test.secret_other'), current_setting('test.dec_1')::uuid) $$,
  'P0002', null, 'another agent in the same tenant cannot read this decision''s context'));
select t(throws_ok($$ select * from public.get_semantic_evaluation_context(current_setting('test.secret_b'), current_setting('test.dec_1')::uuid) $$,
  'P0002', null, 'a credential from another tenant cannot read this decision''s context'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(throws_ok($$ select * from public.get_semantic_evaluation_context(current_setting('test.secret_a'), current_setting('test.dec_1')::uuid) $$,
  '42501', null, 'a signed-in user cannot call the runtime context RPC — only anon is granted'));

-- ---------------------------------------------------------------------
-- Recording
-- ---------------------------------------------------------------------
set local role anon;
select set_config('test.eval_1', (select rec_evaluation_id::text from public.record_semantic_shadow(
  current_setting('test.secret_a'), current_setting('test.dec_1')::uuid, 'mock', 'mock-heuristic', '2026-09-28.1', 'ok',
  '{"schemaVersion":1,"taskAlignment":0.9,"resourceRelevance":0.9,"scopeExpansion":0.05,"externalDisclosure":0.05,"promptInjection":0.95,"suspiciousArgumentChange":0.05,"planDeviation":0.05}'::jsonb,
  array['prompt_injection_phrase'], 'critical', 0.85, 7, repeat('c', 64), '{"schemaVersion":1,"counts":{"email":1}}'::jsonb, null)), true);

select t(isnt(current_setting('test.eval_1'), '', 'a valid shadow observation is recorded'));

select t(is((select rec_disagreement::text from public.record_semantic_shadow(
  current_setting('test.secret_a'), current_setting('test.dec_1')::uuid, 'mock', 'mock-heuristic', '2026-09-28.1', 'ok',
  '{"schemaVersion":1,"taskAlignment":0.9,"resourceRelevance":0.9,"scopeExpansion":0.05,"externalDisclosure":0.05,"promptInjection":0.95,"suspiciousArgumentChange":0.05,"planDeviation":0.05}'::jsonb,
  array['prompt_injection_phrase'], 'critical', 0.85, 7, repeat('c', 64), '{"schemaVersion":1}'::jsonb, null)),
  'semantic_flags_permitted', 'critical semantic risk on an allowed decision is recorded as a disagreement — and only recorded'));

select t(is((select rec_evaluation_id::text from public.record_semantic_shadow(
  current_setting('test.secret_a'), current_setting('test.dec_1')::uuid, 'mock', 'other-model', '9', 'ok',
  '{"schemaVersion":1,"taskAlignment":0.1,"resourceRelevance":0.1,"scopeExpansion":0.1,"externalDisclosure":0.1,"promptInjection":0.1,"suspiciousArgumentChange":0.1,"planDeviation":0.1}'::jsonb,
  '{}', 'low', 0.9, 1, repeat('d', 64), '{"schemaVersion":1}'::jsonb, null)),
  current_setting('test.eval_1'), 'a replay returns the original evaluation and cannot overwrite or add a second opinion'));

select t(is((select rec_replayed from public.record_semantic_shadow(
  current_setting('test.secret_a'), current_setting('test.dec_1')::uuid, 'mock', 'm', '1', 'timeout', null, '{}', 'unknown', 0, 1,
  repeat('d', 64), '{"schemaVersion":1}'::jsonb, 'timeout')), true, 'the replay is labeled as such'));

select t(is((select ctx_existing_evaluation_id::text from public.get_semantic_evaluation_context(current_setting('test.secret_a'), current_setting('test.dec_1')::uuid)),
  current_setting('test.eval_1'), 'the context exposes the existing evaluation so callers skip re-running the provider'));

-- Degraded records.
select t(lives_ok($$ select public.record_semantic_shadow(current_setting('test.secret_a'), current_setting('test.dec_2')::uuid, 'mock', 'm', '1', 'timeout', null, '{}', 'unknown', 0, 800, repeat('e', 64), '{"schemaVersion":1}'::jsonb, 'timeout') $$,
  'a timeout is recorded with null signals and unknown risk'));

-- Forged / malformed evidence.
select t(throws_ok($$ select public.record_semantic_shadow(current_setting('test.secret_a'), current_setting('test.dec_3')::uuid, 'mock', 'm', '1', 'ok', null, '{}', 'low', 0.5, 1, repeat('e', 64), '{"schemaVersion":1}'::jsonb, null) $$,
  '22023', null, 'an ok evaluation without signals is rejected'));
select t(throws_ok($$ select public.record_semantic_shadow(current_setting('test.secret_a'), current_setting('test.dec_3')::uuid, 'mock', 'm', '1', 'ok',
  '{"schemaVersion":1,"taskAlignment":0.9,"resourceRelevance":0.9,"scopeExpansion":0.1,"externalDisclosure":0.1,"promptInjection":0.1,"suspiciousArgumentChange":0.1,"planDeviation":0.1,"allow":1}'::jsonb,
  '{}', 'low', 0.5, 1, repeat('e', 64), '{"schemaVersion":1}'::jsonb, null) $$,
  '22023', null, 'signals with an extra key (an attempt to smuggle authority) are rejected'));
select t(throws_ok($$ select public.record_semantic_shadow(current_setting('test.secret_a'), current_setting('test.dec_3')::uuid, 'mock', 'm', '1', 'ok',
  '{"schemaVersion":1,"taskAlignment":1.5,"resourceRelevance":0.9,"scopeExpansion":0.1,"externalDisclosure":0.1,"promptInjection":0.1,"suspiciousArgumentChange":0.1,"planDeviation":0.1}'::jsonb,
  '{}', 'low', 0.5, 1, repeat('e', 64), '{"schemaVersion":1}'::jsonb, null) $$,
  '22023', null, 'an out-of-range probability is rejected'));
select t(throws_ok($$ select public.record_semantic_shadow(current_setting('test.secret_a'), current_setting('test.dec_3')::uuid, 'mock', 'm', '1', 'ok',
  '{"schemaVersion":1,"taskAlignment":0.9,"resourceRelevance":0.9,"scopeExpansion":0.1,"externalDisclosure":0.1,"promptInjection":0.1,"suspiciousArgumentChange":0.1,"planDeviation":0.1}'::jsonb,
  array['grant_admin'], 'low', 0.5, 1, repeat('e', 64), '{"schemaVersion":1}'::jsonb, null) $$,
  '22023', null, 'an unrecognized indicator code is rejected'));
select t(throws_ok($$ select public.record_semantic_shadow(current_setting('test.secret_a'), current_setting('test.dec_3')::uuid, 'mock', 'm', '1', 'timeout', null, '{}', 'low', 0, 1, repeat('e', 64), '{"schemaVersion":1}'::jsonb, 'timeout') $$,
  '22023', null, 'a degraded evaluation claiming known risk is rejected'));
select t(throws_ok($$ select public.record_semantic_shadow(current_setting('test.secret_a'), current_setting('test.dec_3')::uuid, 'mock', 'm', '1', 'timeout', null, '{}', 'unknown', 0, 1, 'not-a-hash', '{"schemaVersion":1}'::jsonb, 'timeout') $$,
  '22023', null, 'a malformed input hash is rejected'));

-- Isolation.
select t(throws_ok($$ select public.record_semantic_shadow(current_setting('test.secret_other'), current_setting('test.dec_4')::uuid, 'mock', 'm', '1', 'timeout', null, '{}', 'unknown', 0, 1, repeat('e', 64), '{"schemaVersion":1}'::jsonb, 'timeout') $$,
  'P0002', null, 'another agent cannot record evidence for this agent''s decision'));
select t(throws_ok($$ select public.record_semantic_shadow(current_setting('test.secret_b'), current_setting('test.dec_4')::uuid, 'mock', 'm', '1', 'timeout', null, '{}', 'unknown', 0, 1, repeat('e', 64), '{"schemaVersion":1}'::jsonb, 'timeout') $$,
  'P0002', null, 'a credential from another tenant cannot record evidence for this tenant''s decision'));
select t(throws_ok($$ select public.record_semantic_shadow('authority_rk_notarealsecret0000', current_setting('test.dec_4')::uuid, 'mock', 'm', '1', 'timeout', null, '{}', 'unknown', 0, 1, repeat('e', 64), '{"schemaVersion":1}'::jsonb, 'timeout') $$,
  '28000', null, 'an unknown credential cannot record evidence'));

-- Immutability and storage-layer non-authority.
set local role postgres;
select t(throws_ok($$ update public.semantic_shadow_evaluations set risk_level = 'low' where id = current_setting('test.eval_1')::uuid $$,
  '23514', null, 'evidence cannot be updated, even by the table owner (append-only trigger)'));
select t(throws_ok($$ delete from public.semantic_shadow_evaluations where id = current_setting('test.eval_1')::uuid $$,
  '23514', null, 'evidence cannot be deleted'));
select t(throws_ok($$ insert into public.semantic_shadow_evaluations (tenant_id, task_id, tool_request_id, authorization_decision_id, agent_id, authoritative, provider, model, model_version, state, risk_level, confidence, latency_ms, input_hash)
  select d.tenant_id, d.task_id, d.tool_request_id, d.id, '18000000-0000-4000-8000-000000000003', true, 'x', 'x', '1', 'timeout', 'unknown', 0, 1, repeat('f', 64)
  from public.authorization_decisions d where d.id = current_setting('test.dec_5')::uuid $$,
  '23514', null, 'a row can never be marked authoritative — a CHECK constraint forbids it'));
select t(throws_ok($$ insert into public.semantic_shadow_evaluations (tenant_id, task_id, tool_request_id, authorization_decision_id, agent_id, mode, provider, model, model_version, state, risk_level, confidence, latency_ms, input_hash)
  select d.tenant_id, d.task_id, d.tool_request_id, d.id, '18000000-0000-4000-8000-000000000003', 'enforce', 'x', 'x', '1', 'timeout', 'unknown', 0, 1, repeat('f', 64)
  from public.authorization_decisions d where d.id = current_setting('test.dec_5')::uuid $$,
  '23514', null, 'a row can never be recorded in enforce mode'));

-- RLS visibility.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}';
select t(is((select count(*)::int from public.semantic_shadow_evaluations), 2, 'a member of the tenant (even a viewer) can read its shadow evidence'));
select t(throws_ok($$ insert into public.semantic_shadow_evaluations (tenant_id) values ('11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'a client cannot insert evidence directly'));
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(is((select count(*)::int from public.semantic_shadow_evaluations), 0, 'another tenant sees none of it'));

-- Part 4 fix: failed-authentication auditing now persists.
set local role anon;
select public.record_agent_auth_failure('authority_rk_deadbeef00000000notreal');
set local role postgres;
select t(is((select count(*)::int from public.agent_auth_events where attempted_key_prefix = 'authority_rk_deadbeef' and outcome = 'invalid_credential'),
  1, 'a failed authentication is recorded (previously the insert was rolled back by the raise)'));
select t(is((select count(*)::int from public.agent_auth_events where attempted_key_prefix = 'authority_rk_deadbeef' and tenant_id is not null),
  0, 'an unresolvable credential is recorded without a tenant'));
select t(is((select count(*)::int from public.agent_auth_events where attempted_key_prefix like '%notreal%'),
  0, 'only the short prefix is stored, never the presented secret'));
