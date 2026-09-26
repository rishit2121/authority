-- Part 6: the trusted gateway. Direct-RPC bypass closure, monotonic composition,
-- argument privacy, capability issuance / consumption / revocation, and
-- enforcement settings — all against the real deployed schema.

select plan(134);

set local role postgres;

insert into public.principals (id, tenant_id, kind, display_name, user_id) values
  ('19000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Owner (dev.a)', 'a0000000-0000-4000-8000-000000000003'),
  ('19000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Admin (owner.a)', 'a0000000-0000-4000-8000-000000000001'),
  ('19000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'human', 'Fixture Owner (owner.b)', 'b0000000-0000-4000-8000-000000000001');
insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('19000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'agent-19', 'openai', 'gpt', 'x', '19000000-0000-4000-8000-000000000001', 'active'),
  ('19000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', 'agent-19-other', 'openai', 'gpt', 'x', '19000000-0000-4000-8000-000000000001', 'active'),
  ('19000000-0000-4000-8000-0000000000b3', '22222222-2222-4222-8222-222222222222', 'agent-19-b', 'openai', 'gpt', 'x', '19000000-0000-4000-8000-0000000000b1', 'active');
insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('19000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '19000000-0000-4000-8000-000000000003', '19000000-0000-4000-8000-000000000001', 'Read issue 991 in payments-api', 'contract_issued'),
  ('19000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', '19000000-0000-4000-8000-000000000003', '19000000-0000-4000-8000-000000000001', 'Aux task for lifecycle tests', 'contract_issued'),
  ('19000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', '19000000-0000-4000-8000-000000000003', '19000000-0000-4000-8000-000000000001', 'Aux task for key revocation', 'contract_issued'),
  ('19000000-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111', '19000000-0000-4000-8000-000000000009', '19000000-0000-4000-8000-000000000001', 'Other agent task', 'contract_issued');

create function public.t19_activate(p_task uuid, p_id uuid, p_actions jsonb, p_forbidden text[], p_max int)
returns void language sql security definer set search_path = '' as $$
  insert into public.task_authority_contracts (
    id, tenant_id, task_id, version, spec_version, allowed_actions, forbidden_resources, forbidden_operations,
    ephemeral_limits, contract_status, registry_version, compiler_version, input_hash, output_hash,
    data_flow_bindings, required_approvals, activated_at, expires_at, required_approvals_spec, demo_key)
  values (p_id, '11111111-1111-4111-8111-111111111111', p_task, 1, 'v1', p_actions, p_forbidden, '{}',
    jsonb_build_object('schemaVersion', 1, 'maxToolInvocations', p_max, 'expiresInSeconds', 3600),
    'active', 'rv1', 'cv1', repeat('9', 64), repeat('8', 64), '{"schemaVersion":1,"refs":[]}'::jsonb,
    '{"schemaVersion":1,"items":[]}'::jsonb, now(), now() + interval '1 hour', '{"schemaVersion":1,"items":[]}'::jsonb,
    'test19:' || p_id::text)
$$;

select public.t19_activate('19000000-0000-4000-8000-000000000004', '19000000-0000-4000-8000-0000000000c1',
  '{"schemaVersion":1,"items":[
     {"tool":"github.get_issue","constraints":[]},
     {"tool":"github.create_branch","constraints":[{"key":"branch","matches":"fix-*"}],"maxInvocations":3},
     {"tool":"stripe.issue_refund","constraints":[{"key":"customer_id","equals":"cus_1"}]}]}'::jsonb,
  '{"secret-*"}', 40);
select public.t19_activate('19000000-0000-4000-8000-000000000005', '19000000-0000-4000-8000-0000000000c2',
  '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}'::jsonb, '{}', 40);
select public.t19_activate('19000000-0000-4000-8000-000000000006', '19000000-0000-4000-8000-0000000000c3',
  '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}'::jsonb, '{}', 40);
select public.t19_activate('19000000-0000-4000-8000-000000000010', '19000000-0000-4000-8000-0000000000c4',
  '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}'::jsonb, '{}', 40);

create function public.t19(
  p_key text, p_tool text default 'github.get_issue', p_args jsonb default '{}'::jsonb,
  p_task uuid default '19000000-0000-4000-8000-000000000004', p_secret text default null,
  p_sem_state public.semantic_evidence_state default null, p_sem_risk public.semantic_risk_level default null,
  p_risk text default 'low', p_uses int default 1, p_provider text default 'mock', p_resource text default null,
  p_sem_signals jsonb default null, p_token_key text default null)
returns table (status text, replayed boolean, det public.authorization_outcome, fin public.authorization_outcome,
  reasons text[], degraded boolean, narrowed boolean, cap uuid, decision uuid, final_id uuid, max_uses int,
  remaining int, mode public.semantic_mode, policy text)
language sql security definer set search_path = '' as $$
  select c.r_status, c.r_replayed, c.r_det_outcome, c.r_final_outcome, c.r_reason_codes, c.r_degraded, c.r_narrowed,
         c.r_capability_id, c.r_decision_id, c.r_final_decision_id, c.r_capability_max_uses, c.r_remaining_invocations,
         c.r_semantic_mode, c.r_semantic_policy
  from gateway.commit_authorization(
    coalesce(p_secret, current_setting('test.secret_a')), p_task, p_tool, 'op', p_resource, p_args,
    '{"schemaVersion":1,"count":0,"truncated":false,"entries":[]}'::jsonb, null, p_key, 'rv1', 'cv1', p_risk, p_uses,
    encode(extensions.digest('authcap_v1_' || coalesce(p_token_key, p_key), 'sha256'), 'hex'),
    case when p_sem_state is null then null else p_provider end,
    case when p_sem_state is null then null else 'mock-heuristic' end,
    case when p_sem_state is null then null else '2026' end,
    p_sem_state,
    case when p_sem_state = 'ok' then coalesce(p_sem_signals,
      '{"schemaVersion":1,"taskAlignment":0.9,"resourceRelevance":0.9,"scopeExpansion":0.1,"externalDisclosure":0.1,"promptInjection":0.1,"suspiciousArgumentChange":0.1,"planDeviation":0.1}'::jsonb)
      else null end,
    '{}'::text[], p_sem_risk, 0.8, 5, repeat('c', 64), '{"schemaVersion":1}'::jsonb,
    case when p_sem_state = 'timeout' then 'timeout' else null end, 'gw-test') c
$$;

create function public.t19c(
  p_key text, p_token_key text, p_tool text default 'github.get_issue', p_args jsonb default '{}'::jsonb,
  p_secret text default null, p_resource text default null)
returns table (status text, result text, reason text, cap uuid, remaining int, replayed boolean)
language sql security definer set search_path = '' as $$
  select c.cs_status, c.cs_result, c.cs_reason_code, c.cs_capability_id, c.cs_remaining_uses, c.cs_replayed
  from gateway.consume_capability(coalesce(p_secret, current_setting('test.secret_a')),
    encode(extensions.digest('authcap_v1_' || p_token_key, 'sha256'), 'hex'), p_tool, 'op', p_resource, p_args, p_key) c
$$;

-- Credentials.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select set_config('test.secret_a', r.plaintext_secret, true), set_config('test.cred_a', r.credential_id::text, true)
from public.create_agent_credential('19000000-0000-4000-8000-000000000003'::uuid) r;
select set_config('test.secret_other', r.plaintext_secret, true) from public.create_agent_credential('19000000-0000-4000-8000-000000000009'::uuid) r;
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.secret_b', r.plaintext_secret, true) from public.create_agent_credential('19000000-0000-4000-8000-0000000000b3'::uuid) r;
set local role postgres;

-- =====================================================================
-- 1. Trust boundary: the anonymous key reaches nothing.
-- =====================================================================
set local role anon;
select t(throws_ok($$ select gateway.ping() $$, '42501', null, 'anon cannot reach the gateway schema at all'));
select t(throws_ok($$ select * from public.authorize_tool_call('x' || repeat('y', 30), '19000000-0000-4000-8000-000000000004'::uuid, 'github.get_issue', 'op', null, '{}'::jsonb, null, 'k', null, 'rv1', 'cv1') $$,
  '42501', null, 'anon can no longer call the legacy authorize_tool_call'));
select t(throws_ok($$ select * from public.get_semantic_evaluation_context('x' || repeat('y', 30), '19000000-0000-4000-8000-000000000004'::uuid) $$,
  '42501', null, 'anon can no longer read semantic evaluation context'));
select t(throws_ok($$ select * from public.record_semantic_shadow('x' || repeat('y', 30), '19000000-0000-4000-8000-000000000004'::uuid, 'mock', 'm', '1', 'timeout', null, '{}', 'unknown', 0, 1, repeat('a', 64), '{"schemaVersion":1}'::jsonb, 'timeout') $$,
  '42501', null, 'anon cannot forge semantic evidence through the Part 5 recorder'));
select t(throws_ok($$ select public.record_agent_auth_failure('x' || repeat('y', 30)) $$,
  '42501', null, 'anon cannot write auth-failure audit rows'));
select t(throws_ok($$ select * from public.capability_tokens $$, '42501', null, 'anon cannot read capability tokens'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(throws_ok($$ select gateway.ping() $$, '42501', null, 'a signed-in user cannot reach the gateway schema'));
select t(throws_ok($$ select * from public.authorize_tool_call('x' || repeat('y', 30), '19000000-0000-4000-8000-000000000004'::uuid, 'github.get_issue', 'op', null, '{}'::jsonb, null, 'k', null, 'rv1', 'cv1') $$,
  '42501', null, 'a signed-in user cannot call the legacy authorize_tool_call either'));
select t(throws_ok($$ insert into public.capability_tokens (tenant_id) values ('11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'no client can mint a capability by inserting a row'));
select t(throws_ok($$ select token_hash from public.capability_tokens limit 1 $$,
  '42501', null, 'even a tenant owner cannot read a capability''s token hash'));

set local role service_role;
select t(throws_ok($$ select * from public.authorize_tool_call('x' || repeat('y', 30), '19000000-0000-4000-8000-000000000004'::uuid, 'github.get_issue', 'op', null, '{}'::jsonb, null, 'k', null, 'rv1', 'cv1') $$,
  '42501', null, 'the service-role key cannot call the legacy authorize_tool_call'));

-- pgTAP's own functions live in a schema the gateway role deliberately cannot
-- use, so its attempts are captured here and asserted as the owner afterwards.
set local role authority_gateway;
select set_config('t19.ping', (select gateway.ping())::text, true);
do $$ begin perform 1 from public.tool_requests; perform set_config('t19.tr', 'allowed', true);
  exception when others then perform set_config('t19.tr', sqlstate, true); end $$;
do $$ begin perform 1 from public.capability_tokens; perform set_config('t19.ct', 'allowed', true);
  exception when others then perform set_config('t19.ct', sqlstate, true); end $$;
do $$ begin perform 1 from public.authorize_tool_call('x' || repeat('y', 30), '19000000-0000-4000-8000-000000000004'::uuid, 'github.get_issue', 'op', null, '{}'::jsonb, null, 'k', null, 'rv1', 'cv1');
  perform set_config('t19.legacy', 'allowed', true);
  exception when others then perform set_config('t19.legacy', sqlstate, true); end $$;
set local role postgres;
select t(is(current_setting('t19.ping'), 'true', 'the gateway role can call gateway functions'));
select t(is(current_setting('t19.tr'), '42501', 'the gateway role holds no table privileges'));
select t(is(current_setting('t19.ct'), '42501', 'the gateway role cannot read capability tokens directly'));
select t(is(current_setting('t19.legacy'), '42501', 'the gateway role cannot call the legacy raw-argument function'));

-- =====================================================================
-- 2. Composition is monotonic — exhaustively.
-- =====================================================================
select t(is((select count(*)::int
  from unnest(enum_range(null::public.authorization_outcome)) d,
       unnest(enum_range(null::public.semantic_mode)) m,
       unnest(enum_range(null::public.semantic_evidence_state)) s,
       unnest(enum_range(null::public.semantic_risk_level)) r,
       (values (true), (false)) q(req), (values (true), (false)) e(enf),
       lateral gateway.compose_outcome(d, m, s, r, q.req, e.enf) c
  where gateway.outcome_rank(c.c_final) > gateway.outcome_rank(d)), 0,
  'across every input combination the composed outcome is never more permissive than the deterministic one'));
select t(is((select count(*)::int
  from unnest(enum_range(null::public.authorization_outcome)) d,
       unnest(enum_range(null::public.semantic_mode)) m,
       unnest(enum_range(null::public.semantic_evidence_state)) s,
       unnest(enum_range(null::public.semantic_risk_level)) r,
       (values (true), (false)) q(req), (values (true), (false)) e(enf),
       lateral gateway.compose_outcome(d, m, s, r, q.req, e.enf) c
  where d not in ('allow', 'allow_constrained') and c.c_final <> d), 0,
  'a deterministic deny/clarify/replan/approval is never changed by anything semantic'));
select t(is((select count(*)::int
  from unnest(enum_range(null::public.authorization_outcome)) d,
       unnest(enum_range(null::public.semantic_evidence_state)) s,
       unnest(enum_range(null::public.semantic_risk_level)) r,
       lateral gateway.compose_outcome(d, 'shadow', s, r, true, true) c
  where c.c_final <> d or c.c_degraded), 0, 'shadow mode never changes an outcome, whatever the evidence'));
select t(is((select c_final::text from gateway.compose_outcome('allow', 'enforce', 'ok', 'critical', false, true)), 'deny', 'enforce: allow + critical semantic risk -> deny'));
select t(is((select c_final::text from gateway.compose_outcome('allow', 'enforce', 'ok', 'high', false, true)), 'require_approval', 'enforce: allow + high semantic risk -> require_approval'));
select t(is((select c_final::text from gateway.compose_outcome('allow_constrained', 'enforce', 'ok', 'medium', false, true)), 'allow_constrained', 'enforce: medium risk leaves the allow as it was'));
select t(is((select c_final::text from gateway.compose_outcome('deny', 'enforce', 'ok', 'low', true, true)), 'deny', 'a deterministic deny plus a "safe" semantic verdict stays a deny'));
select t(is((select c_final::text from gateway.compose_outcome('allow', 'enforce', 'timeout', null, true, true)), 'deny', 'required semantic + timeout fails closed'));
select t(is((select c_final::text || (select c_degraded::text from gateway.compose_outcome('allow', 'enforce', 'timeout', null, false, true)) from gateway.compose_outcome('allow', 'enforce', 'timeout', null, false, true)), 'allowtrue', 'optional semantic + timeout keeps the allow, marked degraded'));
select t(is((select c_final::text from gateway.compose_outcome('allow', 'enforce', 'ok', 'low', true, false)), 'deny', 'required semantic with an un-approved provider fails closed even if the verdict looked safe'));
select t(is((select c_final::text from gateway.compose_outcome('allow', 'enforce', null, null, true, true)), 'deny', 'required semantic with no evidence at all fails closed'));
select t(is((select gateway.provider_enforcement_grade('mock', 'production')), false, 'the mock provider is never enforcement-grade in production'));
select t(is((select gateway.provider_enforcement_grade('legacy_lexical', 'staging')), false, 'the lexical baseline is never enforcement-grade in staging'));
select t(is((select gateway.provider_enforcement_grade('mock', 'development')), true, 'the mock may enforce only inside a development tenant'));
select t(is((select gateway.provider_enforcement_grade('openai_compatible', 'production')), true, 'a real hosted provider is enforcement-grade'));

-- =====================================================================
-- 3. Deterministic path, privacy, capabilities (semantic off).
-- =====================================================================
select t(is((select fin::text from public.t19('g-1', 'github.get_issue', '{"note":"SENTINEL-RAW-VALUE-123","issue_number":"991"}')), 'allow', 'an unconstrained allowed call is allowed'));
select t(is((select count(*)::int from public.capability_tokens where token_hash = encode(extensions.digest('authcap_v1_g-1', 'sha256'), 'hex')), 1, 'the capability is stored under the hash of its token'));
select t(is((select count(*)::int from public.capability_tokens where token_hash = 'authcap_v1_g-1'), 0, 'the plaintext token is not stored anywhere'));
select t(is((select arguments_redacted::text || (normalized_arguments -> 'values')::text from public.tool_requests where idempotency_key = 'g-1' and task_id = '19000000-0000-4000-8000-000000000004'), 'true{}', 'raw arguments are not persisted: the values object is empty and the row is flagged redacted'));
select t(is((select (argument_audit ->> 'schemaVersion') from public.tool_requests where idempotency_key = 'g-1' and task_id = '19000000-0000-4000-8000-000000000004'), '1', 'only the redacted audit representation is kept'));
select t(is((select (select count(*) from public.tool_requests t where t::text like '%SENTINEL-RAW%')
            + (select count(*) from public.authorization_decisions t where t::text like '%SENTINEL-RAW%')
            + (select count(*) from public.final_decisions t where t::text like '%SENTINEL-RAW%')
            + (select count(*) from public.capability_tokens t where t::text like '%SENTINEL-RAW%')
            + (select count(*) from public.execution_events t where t::text like '%SENTINEL-RAW%')
            + (select count(*) from public.capabilities t where t::text like '%SENTINEL-RAW%')), 0::bigint,
  'a distinctive raw argument value appears in no persisted row'));
select t(is((select arguments_hash from public.tool_requests where idempotency_key = 'g-1' and task_id = '19000000-0000-4000-8000-000000000004'),
  encode(extensions.digest('{"note": "SENTINEL-RAW-VALUE-123", "issue_number": "991"}', 'sha256'), 'hex'), 'the request is identified by a deterministic argument hash'));
select t(is((select (select count(*) from public.final_decisions where authorization_decision_id = d.id) from public.authorization_decisions d join public.tool_requests tr on tr.id = d.tool_request_id where tr.idempotency_key = 'g-1' and tr.task_id = '19000000-0000-4000-8000-000000000004'), 1::bigint, 'the deterministic decision and the final decision are stored separately'));

select t(is((select fin::text from public.t19('g-2', 'github.delete_repo')), 'replan', 'a tool outside the contract is replan'));
select t(is((select (cap is null)::text from public.t19('g-2', 'github.delete_repo')), 'true', 'and gets no capability'));
select t(is((select count(*)::int from public.capability_tokens ct join public.final_decisions f on f.id = ct.final_decision_id where f.final_outcome <> 'allow' and f.final_outcome <> 'allow_constrained'), 0, 'no capability exists for any non-allow final decision'));
select t(is((select fin::text from public.t19('g-3', 'github.get_issue', '{"note":"secret-vault"}')), 'deny', 'a forbidden resource is denied deterministically'));
select t(is((select (select cap is null from public.t19('g-3', 'github.get_issue', '{"note":"secret-vault"}'))::text), 'true', 'a denied request receives no capability'));
select t(is((select fin::text from public.t19('g-4', 'github.create_branch', '{"branch":"fix-1"}')), 'allow_constrained', 'a constrained action is allow_constrained'));
select t(is((select resource_constraints -> 'items' -> 0 ->> 'key' from public.capability_tokens where token_hash = encode(extensions.digest('authcap_v1_g-4', 'sha256'), 'hex')), 'branch', 'the capability carries the exact constraints the decision applied'));
select t(is((select fin::text from public.t19('g-5', 'github.create_branch', '{"branch":"release-1"}')), 'deny', 'arguments outside the constraint are denied'));
select t(is((select uses::text || '/' || max_uses::text from public.capability_tokens where token_hash = encode(extensions.digest('authcap_v1_g-4', 'sha256'), 'hex')), '0/1', 'a capability is single-use by default'));

select t(is((select max_uses from public.t19('g-6', 'github.get_issue', '{}', p_uses => 3)), 3, 'explicitly bounded multi-use is supported'));
select t(is((select consumed_uses from public.capabilities where contract_id = '19000000-0000-4000-8000-0000000000c1' and tool = 'github.get_issue'), 4, 'authorization reserved exactly the uses it granted (1 + 3)'));
select t(is((select fin::text from public.t19('g-7', 'github.create_branch', '{"branch":"fix-9"}', p_uses => 3)), 'deny', 'a multi-use request exceeding the action budget is denied'));

-- Idempotency.
select t(is((select replayed::text from public.t19('g-1', 'github.get_issue', '{"note":"SENTINEL-RAW-VALUE-123","issue_number":"991"}')), 'true', 'an identical retry is a replay'));
select t(is((select cap::text from public.t19('g-1', 'github.get_issue', '{"note":"SENTINEL-RAW-VALUE-123","issue_number":"991"}')),
  (select ct.id::text from public.capability_tokens ct where ct.token_hash = encode(extensions.digest('authcap_v1_g-1', 'sha256'), 'hex')), 'a replay returns the same capability id (never a new token)'));
select t(is((select count(*)::int from public.capability_tokens ct join public.tool_requests tr on tr.id = (select tool_request_id from public.authorization_decisions where id = ct.authorization_decision_id) where tr.idempotency_key = 'g-1' and tr.task_id = '19000000-0000-4000-8000-000000000004'), 1, 'a replay created no second capability'));
select t(is((select status from public.t19('g-1', 'github.get_issue', '{"other":"payload"}')), 'idempotency_conflict', 'the same key with a different payload is reported as a conflict, not replayed'));

-- Authentication failures persist (they used to be rolled back by a raise).
select t(is((select status from public.t19('g-8', 'github.get_issue', '{}', p_secret => 'authority_rk_' || repeat('0', 64))), 'invalid_credential', 'an unknown key is reported as invalid_credential'));
select t(is((select count(*)::int from public.agent_auth_events where attempted_key_prefix = 'authority_rk_00000000' and outcome = 'invalid_credential'), 1, 'the failed attempt was recorded — the audit row survives because the function returns'));
select t(is((select status from public.t19('g-9', 'github.get_issue', '{}', p_secret => current_setting('test.secret_other'))), 'agent_mismatch', 'a key for a different agent is refused for this task'));
select t(is((select status from public.t19('g-10', 'github.get_issue', '{}', p_secret => current_setting('test.secret_b'))), 'task_not_found', 'a key from another tenant cannot see this tenant''s task'));

-- =====================================================================
-- 4. Capability consumption (simulated).
-- =====================================================================
select t(is((select result || '/' || remaining::text from public.t19c('c-1', 'g-1', 'github.get_issue', '{"note":"SENTINEL-RAW-VALUE-123","issue_number":"991"}')), 'accepted/0', 'the exact call consumes the single use'));
select t(is((select status from public.capability_tokens where token_hash = encode(extensions.digest('authcap_v1_g-1', 'sha256'), 'hex')), 'consumed', 'a fully used capability becomes consumed'));
select t(is((select replayed::text || result from public.t19c('c-1', 'g-1', 'github.get_issue', '{"note":"SENTINEL-RAW-VALUE-123","issue_number":"991"}')), 'trueaccepted', 'retrying with the same idempotency key replays the original result'));
select t(is((select uses from public.capability_tokens where token_hash = encode(extensions.digest('authcap_v1_g-1', 'sha256'), 'hex')), 1, 'the idempotent retry did not consume a second use'));
select t(is((select reason from public.t19c('c-2', 'g-1', 'github.get_issue', '{"note":"SENTINEL-RAW-VALUE-123","issue_number":"991"}')), 'CAPABILITY_ALREADY_USED', 'replay with a new key is rejected as already used'));
select t(is((select count(*)::int from public.capability_consumptions where reason_code = 'CAPABILITY_ALREADY_USED'), 1, 'the replay attempt is recorded for audit'));
select t(is((select reason from public.t19c('c-1', 'g-1', 'github.get_issue', '{"different":"args"}')), 'IDEMPOTENCY_CONFLICT', 'reusing a consumption key with a different call is a conflict'));

select t(is((select reason from public.t19c('c-3', 'g-4', 'github.create_branch', '{"branch":"fix-2"}')), 'SCOPE_MISMATCH', 'a capability cannot authorize different arguments than the decision was made for'));
select t(is((select reason from public.t19c('c-4', 'g-4', 'github.get_issue', '{"branch":"fix-1"}')), 'SCOPE_MISMATCH', 'a capability cannot be used for a different tool'));
select t(is((select reason from public.t19c('c-5', 'g-4', 'github.create_branch', '{"branch":"fix-1"}', p_resource => 'other')), 'SCOPE_MISMATCH', 'a capability cannot be used for a different resource'));
select t(is((select uses from public.capability_tokens where token_hash = encode(extensions.digest('authcap_v1_g-4', 'sha256'), 'hex')), 0, 'rejected attempts consumed nothing'));
select t(is((select result from public.t19c('c-6', 'g-4', 'github.create_branch', '{"branch":"fix-1"}')), 'accepted', 'the exact call still works after the rejected attempts'));

select t(is((select reason from public.t19c('c-7', 'g-6', 'github.get_issue', '{}', p_secret => current_setting('test.secret_other'))), 'CAPABILITY_NOT_FOUND', 'another agent in the same tenant cannot use this capability'));
select t(is((select reason from public.t19c('c-8', 'g-6', 'github.get_issue', '{}', p_secret => current_setting('test.secret_b'))), 'CAPABILITY_NOT_FOUND', 'a key from another tenant cannot use this capability'));
select t(is((select result || remaining::text from public.t19c('c-9', 'g-6', 'github.get_issue', '{}')), 'accepted2', 'a multi-use capability decrements one use at a time'));

-- Revocation.
select t(is((select fin::text from public.t19('g-11', 'github.get_issue', '{}')), 'allow', 'a capability to revoke'));
select t(is((select rv_result from gateway.revoke_capability(current_setting('test.secret_a'), (select id from public.capability_tokens where token_hash = encode(extensions.digest('authcap_v1_g-11', 'sha256'), 'hex')), 'no longer needed')), 'revoked', 'an agent can revoke its own capability'));
select t(is((select rv_result from gateway.revoke_capability(current_setting('test.secret_a'), (select id from public.capability_tokens where token_hash = encode(extensions.digest('authcap_v1_g-11', 'sha256'), 'hex')), 'again')), 'already_revoked', 'revocation is idempotent'));
select t(is((select reason from public.t19c('c-10', 'g-11', 'github.get_issue', '{}')), 'CAPABILITY_REVOKED', 'a revoked capability is rejected'));
select t(is((select rv_result from gateway.revoke_capability(current_setting('test.secret_other'), (select id from public.capability_tokens where token_hash = encode(extensions.digest('authcap_v1_g-11', 'sha256'), 'hex')), 'x')), 'not_found', 'another agent cannot revoke it (indistinguishable from not found)'));
select t(is((select rv_result from gateway.revoke_capability(current_setting('test.secret_a'), (select id from public.capability_tokens where token_hash = encode(extensions.digest('authcap_v1_g-1', 'sha256'), 'hex')), 'x')), 'not_revocable', 'a fully used capability cannot be revoked'));

select t(is((select fin::text from public.t19('g-12', 'github.get_issue', '{}')), 'allow', 'a second capability, for admin revocation'));
select set_config('test.cap12', (select id::text from public.capability_tokens where token_hash = encode(extensions.digest('authcap_v1_g-12', 'sha256'), 'hex')), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(throws_ok($$ select public.revoke_capability(current_setting('test.cap12')::uuid, 'dev cannot') $$, '42501', null, 'a developer cannot revoke a capability'));
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(throws_ok($$ select public.revoke_capability(current_setting('test.cap12')::uuid, 'other tenant') $$, '42501', null, 'another tenant''s admin cannot revoke it'));
select t(is((select count(*)::int from public.capability_tokens), 0, 'another tenant sees none of these capabilities'));
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(lives_ok($$ select public.revoke_capability(current_setting('test.cap12')::uuid, 'admin revoked') $$, 'an owner can revoke a capability'));
select t(is((select revoked_by from public.capability_tokens where id = current_setting('test.cap12')::uuid), 'admin', 'the revocation records who revoked it'));
select t(cmp_ok((select count(*)::int from public.capability_tokens), '>', 0, 'a tenant member can read capability metadata'));
set local role postgres;

-- Expiry, and revocation of everything a capability depends on.
select t(is((select fin::text from public.t19('g-13', 'github.get_issue', '{}', p_task => '19000000-0000-4000-8000-000000000005')), 'allow', 'a capability on the aux task'));
alter table public.capability_tokens disable trigger capability_tokens_guard;
update public.capability_tokens set issued_at = now() - interval '30 seconds', expires_at = now() - interval '1 second' where token_hash = encode(extensions.digest('authcap_v1_g-13', 'sha256'), 'hex');
alter table public.capability_tokens enable trigger capability_tokens_guard;
select t(is((select reason from public.t19c('c-11', 'g-13', 'github.get_issue', '{}')), 'CAPABILITY_EXPIRED', 'an expired capability is rejected'));

select t(is((select fin::text from public.t19('g-14', 'github.get_issue', '{}', p_task => '19000000-0000-4000-8000-000000000005')), 'allow', 'a capability whose task will be terminated'));
update public.tasks set status = 'terminated' where id = '19000000-0000-4000-8000-000000000005';
select t(is((select reason from public.t19c('c-12', 'g-14', 'github.get_issue', '{}')), 'TASK_NO_LONGER_EXECUTABLE', 'a capability dies with its task'));
select t(is((select status || '/' || revoked_by from public.capability_tokens where token_hash = encode(extensions.digest('authcap_v1_g-14', 'sha256'), 'hex')), 'revoked/system', 'and is marked revoked by the system'));

select t(is((select fin::text from public.t19('g-15', 'github.get_issue', '{}')), 'allow', 'a capability whose contract will be revoked'));
update public.task_authority_contracts set contract_status = 'revoked', revoked_at = now(), revocation_reason = 'test'
  where id = '19000000-0000-4000-8000-0000000000c1';
select t(is((select reason from public.t19c('c-13', 'g-15', 'github.get_issue', '{}')), 'CONTRACT_NO_LONGER_ACTIVE', 'a capability dies with its contract'));

select t(is((select fin::text from public.t19('g-16', 'github.get_issue', '{}', p_task => '19000000-0000-4000-8000-000000000006')), 'allow', 'a capability issued under key A'));
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select set_config('test.secret_a_second', r.plaintext_secret, true) from public.create_agent_credential('19000000-0000-4000-8000-000000000003'::uuid) r;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.revoke_agent_credential(current_setting('test.cred_a')::uuid, 'rotating');
set local role postgres;
select t(is((select reason from public.t19c('c-14', 'g-16', 'github.get_issue', '{}', p_secret => current_setting('test.secret_a_second'))), 'AGENT_OR_KEY_REVOKED', 'a capability cannot outlive the key that requested it, even for the same agent'));
select t(is((select status from public.t19('g-17', 'github.get_issue', '{}', p_task => '19000000-0000-4000-8000-000000000006')), 'revoked_credential', 'the revoked key itself is refused at the gateway'));

-- =====================================================================
-- 5. Enforcement settings and end-to-end composition (development tenant).
-- =====================================================================
-- Key A was revoked above; continue with the agent's second key.
select set_config('test.secret_a', current_setting('test.secret_a_second'), true);


set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(throws_ok($$ select public.set_semantic_settings_v2('11111111-1111-4111-8111-111111111111'::uuid, 'shadow', 'mock', 'mock-heuristic', 500, '{}', 60, false) $$,
  '42501', null, 'a developer cannot change semantic settings'));
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(throws_ok($$ select public.set_semantic_settings_v2('11111111-1111-4111-8111-111111111111'::uuid, 'enforce', 'mock', 'mock-heuristic', 500, '{}', 60, false) $$,
  '0A000', null, 'enforce is refused without an explicit approval'));
select t(throws_ok($$ select public.set_semantic_settings('11111111-1111-4111-8111-111111111111'::uuid, 'enforce', 'mock', 'mock-heuristic', 500) $$,
  '0A000', null, 'the Part 5 entry point cannot be used to sidestep the approval'));
select t(throws_ok($$ select public.set_semantic_settings_v2('11111111-1111-4111-8111-111111111111'::uuid, 'shadow', 'mock', 'mock-heuristic', 500, '{extreme}', 60, false) $$,
  '23514', null, 'an unknown required risk class is refused'));
select t(throws_ok($$ select public.set_semantic_settings_v2('11111111-1111-4111-8111-111111111111'::uuid, 'shadow', 'mock', 'mock-heuristic', 500, '{}', 100000, false) $$,
  '23514', null, 'a capability TTL beyond 15 minutes is refused'));
select t(lives_ok($$ select public.set_semantic_settings_v2('11111111-1111-4111-8111-111111111111'::uuid, 'enforce', 'mock', 'mock-heuristic', 500, '{high}', 60, true) $$,
  'an owner can enable enforcement with the mock inside a development tenant, with explicit approval'));
select t(is((select enforcement_approved_provider from public.semantic_settings where tenant_id = '11111111-1111-4111-8111-111111111111'), 'mock', 'the approval names the exact provider'));
set local role postgres;
select t(throws_ok($$ update public.semantic_settings set enforcement_approved_at = null where tenant_id = '11111111-1111-4111-8111-111111111111' $$,
  '23514', null, 'even the table owner cannot leave enforce mode without an approval on record'));

-- Live composition. Note: t19c above revoked contract c1; use the aux contract on task 4's sibling via a fresh task.
insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('19000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', '19000000-0000-4000-8000-000000000003', '19000000-0000-4000-8000-000000000001', 'Enforcement task', 'contract_issued');
select public.t19_activate('19000000-0000-4000-8000-000000000007', '19000000-0000-4000-8000-0000000000c6',
  '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]},{"tool":"github.delete_branch","constraints":[]}]}'::jsonb, '{}', 100);

select t(is((select fin::text || ':' || (cap is null)::text from public.t19('e-1', 'github.get_issue', '{}', p_task => '19000000-0000-4000-8000-000000000007', p_sem_state => 'ok', p_sem_risk => 'low')), 'allow:false', 'enforce: deterministic allow + low semantic risk -> allow with a capability'));
select t(is((select fin::text || ':' || (cap is null)::text || ':' || narrowed::text from public.t19('e-2', 'github.get_issue', '{}', p_task => '19000000-0000-4000-8000-000000000007', p_sem_state => 'ok', p_sem_risk => 'critical')), 'deny:true:true', 'enforce: deterministic allow + critical semantic risk -> deny, no capability, narrowed'));
select t(is((select fin::text from public.t19('e-3', 'github.get_issue', '{}', p_task => '19000000-0000-4000-8000-000000000007', p_sem_state => 'ok', p_sem_risk => 'high')), 'require_approval', 'enforce: high semantic risk requires approval'));
select t(is((select (det::text || '>' || fin::text) from public.t19('e-2', 'github.get_issue', '{}', p_task => '19000000-0000-4000-8000-000000000007', p_sem_state => 'ok', p_sem_risk => 'critical')), 'allow>deny', 'the deterministic and final results are reported separately'));
select t(is((select consumed_uses from public.capabilities where contract_id = '19000000-0000-4000-8000-0000000000c6' and tool = 'github.get_issue'), 1, 'semantic narrowing consumed no budget (only the one allow did)'));
select t(is((select count(*)::int from public.final_decisions f where f.narrowed and f.deterministic_outcome = 'allow' and f.final_outcome = 'deny'), 1, 'the final decision row records the narrowing'));
select t(is((select fin::text from public.t19('e-4', 'github.unknown_tool', '{}', p_task => '19000000-0000-4000-8000-000000000007', p_sem_state => 'ok', p_sem_risk => 'low')), 'replan', 'a deterministic replan stays replan whatever semantic says'));

select t(is((select fin::text || ':' || degraded::text from public.t19('e-5', 'github.delete_branch', '{}', p_task => '19000000-0000-4000-8000-000000000007', p_risk => 'high', p_sem_state => 'timeout', p_sem_risk => 'unknown')), 'deny:true', 'required (high-risk class) + semantic timeout fails closed'));
select t(is((select 'SEMANTIC_REQUIRED_UNAVAILABLE' = any(reasons) from public.t19('e-5', 'github.delete_branch', '{}', p_task => '19000000-0000-4000-8000-000000000007', p_risk => 'high', p_sem_state => 'timeout', p_sem_risk => 'unknown')), true, 'the fail-closed reason is recorded'));
select t(is((select fin::text || ':' || degraded::text from public.t19('e-6', 'github.get_issue', '{}', p_task => '19000000-0000-4000-8000-000000000007', p_risk => 'low', p_sem_state => 'timeout', p_sem_risk => 'unknown')), 'allow:true', 'optional (low-risk class) + semantic timeout keeps the allow, explicitly degraded'));
select t(is((select fin::text from public.t19('e-7', 'github.delete_branch', '{}', p_task => '19000000-0000-4000-8000-000000000007', p_risk => 'high')), 'deny', 'required + no evidence at all fails closed'));
select t(is((select fin::text from public.t19('e-8', 'github.delete_branch', '{}', p_task => '19000000-0000-4000-8000-000000000007', p_risk => 'high', p_provider => 'openai_compatible', p_sem_state => 'ok', p_sem_risk => 'low')), 'deny', 'evidence from a provider other than the configured one is ignored, so a required call fails closed'));
select t(is((select count(*)::int from public.semantic_evaluations where tool_request_id in (select id from public.tool_requests where idempotency_key = 'e-8')), 0, 'and that mismatched evidence was not recorded'));
select t(throws_ok($$ select * from public.t19('e-9', 'github.get_issue', '{}', p_task => '19000000-0000-4000-8000-000000000007', p_sem_state => 'ok', p_sem_risk => 'low', p_sem_signals => '{"schemaVersion":1,"taskAlignment":0.9,"resourceRelevance":0.9,"scopeExpansion":0.1,"externalDisclosure":0.1,"promptInjection":0.1,"suspiciousArgumentChange":0.1,"planDeviation":0.1,"allow":1}'::jsonb) $$,
  '22023', null, 'forged evidence carrying an extra field is refused by the database'));
select t(throws_ok($$ select * from public.t19('e-10', 'github.get_issue', '{}', p_task => '19000000-0000-4000-8000-000000000007', p_sem_state => 'ok', p_sem_risk => 'unknown') $$,
  '22023', null, 'an "ok" evaluation with unknown risk is refused'));

-- Storage-layer guarantees.
select t(throws_ok($$ insert into public.final_decisions (tenant_id, task_id, tool_request_id, authorization_decision_id, deterministic_outcome, final_outcome, semantic_mode, semantic_policy, risk_class, narrowed, gateway_version)
  select d.tenant_id, d.task_id, d.tool_request_id, d.id, 'deny', 'allow', 'enforce', 'optional', 'low', true, 'x'
  from public.authorization_decisions d where d.outcome = 'deny' limit 1 $$,
  '23514', null, 'a final decision more permissive than the deterministic one cannot be stored'));
select t(throws_ok($$ update public.final_decisions set final_outcome = 'allow' where narrowed $$, '23514', null, 'final decisions are append-only'));
select t(throws_ok($$ delete from public.semantic_evaluations $$, '23514', null, 'gateway-attested semantic evaluations are append-only'));
select t(throws_ok($$ update public.capability_tokens set arguments_hash = repeat('f', 64) where status = 'active' $$, '23514', null, 'a capability''s binding is immutable'));
select t(throws_ok($$ update public.capability_tokens set uses = 0 where uses > 0 $$, '23514', null, 'a capability''s use count can only go up'));
select t(throws_ok($$ insert into public.capability_tokens (tenant_id, agent_id, task_id, credential_id, contract_id, contract_version, authorization_decision_id, final_decision_id, budget_capability_id, tool, operation, resource_constraints, arguments_hash, max_uses, expires_at, token_hash)
  select ct.tenant_id, ct.agent_id, ct.task_id, ct.credential_id, ct.contract_id, ct.contract_version, ct.authorization_decision_id, ct.final_decision_id, ct.budget_capability_id, ct.tool, ct.operation, ct.resource_constraints, ct.arguments_hash, 1, now() + interval '20 minutes', repeat('e', 64) from public.capability_tokens ct limit 1 $$,
  '23514', null, 'a capability cannot be issued with a lifetime beyond 15 minutes'));
select t(throws_ok($$ insert into public.capability_consumptions (tenant_id, capability_id, agent_id, idempotency_key, request_hash, result, reason_code, use_number, simulated)
  select ct.tenant_id, ct.id, ct.agent_id, 'real-1', repeat('a', 64), 'accepted', 'ACCEPTED', 1, false from public.capability_tokens ct limit 1 $$,
  '23514', null, 'every consumption in this phase is a simulation — a non-simulated one cannot be recorded'));

-- The mock reports an intrinsic model name; a tenant-typed model string must not discard its evidence.
update public.semantic_settings set model = 'custom-model', enforcement_approved_model = 'custom-model'
  where tenant_id = '11111111-1111-4111-8111-111111111111';
select t(is((select fin::text from public.t19('e-11', 'github.get_issue', '{}', p_task => '19000000-0000-4000-8000-000000000007', p_sem_state => 'ok', p_sem_risk => 'critical')), 'deny', 'evidence from the mock is honored even when the tenant typed a different model name'));

-- A production tenant cannot enable enforcement with a heuristic provider, but can with a hosted one.
update public.tenants set environment = 'production' where id = '22222222-2222-4222-8222-222222222222';
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(throws_ok($$ select public.set_semantic_settings_v2('22222222-2222-4222-8222-222222222222'::uuid, 'enforce', 'mock', 'mock-heuristic', 500, '{}', 60, true) $$,
  '0A000', null, 'a production tenant cannot enforce with the mock provider, even with approval'));
select t(throws_ok($$ select public.set_semantic_settings_v2('22222222-2222-4222-8222-222222222222'::uuid, 'enforce', 'legacy_lexical', 'x', 500, '{}', 60, true) $$,
  '0A000', null, 'nor with the lexical baseline'));
select t(lives_ok($$ select public.set_semantic_settings_v2('22222222-2222-4222-8222-222222222222'::uuid, 'enforce', 'openai_compatible', 'gpt-4o-mini', 500, '{high}', 60, true) $$,
  'but it can with a hosted, enforcement-grade provider once explicitly approved'));
select t(lives_ok($$ select public.set_semantic_settings_v2('22222222-2222-4222-8222-222222222222'::uuid, 'shadow', 'mock', 'mock-heuristic', 500, '{}', 60, false) $$,
  'the mock can still run in shadow mode in production'));
select t(is((select enforcement_approved_at is null from public.semantic_settings where tenant_id = '22222222-2222-4222-8222-222222222222'), true,
  'switching provider voided the earlier enforcement approval'));
set local role postgres;

-- An agent revoked after issuance takes its capabilities with it.
select t(is((select fin::text from public.t19('g-18', 'github.get_issue', '{}', p_task => '19000000-0000-4000-8000-000000000010', p_secret => current_setting('test.secret_other'))), 'allow', 'a capability for the second agent'));
update public.agents set status = 'revoked' where id = '19000000-0000-4000-8000-000000000009';
select t(is((select status from public.t19c('c-15', 'g-18', 'github.get_issue', '{}', p_secret => current_setting('test.secret_other'))), 'revoked_credential', 'once its agent is revoked, even its own valid key is refused for consumption'));
update public.agents set status = 'active' where id = '19000000-0000-4000-8000-000000000009';
