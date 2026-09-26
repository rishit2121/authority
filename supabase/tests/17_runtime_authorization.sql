-- Part 4: authorize_tool_call() end-to-end, plus the agent-credential RPCs
-- that mint what it authenticates.
--
-- Runs as a mix of `authenticated` (creating/revoking credentials, proposing
-- and activating a contract — all ordinary session-bound actions) and
-- `anon` (the only role granted EXECUTE on authorize_tool_call() itself,
-- since a real agent has no Supabase session at all).

select plan(39);

set local role postgres;

insert into public.principals (id, tenant_id, kind, display_name, user_id) values
  ('17000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
    'human', 'Fixture Task Owner (dev.a)', 'a0000000-0000-4000-8000-000000000003'),
  ('17000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
    'human', 'Fixture Activator (owner.a)', 'a0000000-0000-4000-8000-000000000001');

insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('17000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
    'agent-17', 'openai', 'gpt', 'x', '17000000-0000-4000-8000-000000000001', 'active'),
  ('17000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111',
    'agent-17-other', 'openai', 'gpt', 'x', '17000000-0000-4000-8000-000000000001', 'active');

insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('17000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
    '17000000-0000-4000-8000-000000000003', '17000000-0000-4000-8000-000000000001', 'Fixture task 17', 'pending'),
  ('17000000-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111',
    '17000000-0000-4000-8000-000000000009', '17000000-0000-4000-8000-000000000001', 'Fixture task 17 other agent', 'pending');

insert into public.plans (id, tenant_id, task_id, version, input_hash) values
  ('17000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111',
    '17000000-0000-4000-8000-000000000004', 1, repeat('7', 64));

-- ---------------------------------------------------------------------
-- Credential issuance and revocation.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';

select t(is(
  (select count(*)::int from public.create_agent_credential('17000000-0000-4000-8000-000000000003'::uuid)),
  1,
  'a developer can issue a runtime credential for their own agent'));

select set_config(
  'test.secret_1',
  (select plaintext_secret from public.create_agent_credential('17000000-0000-4000-8000-000000000003'::uuid)),
  true
);
select set_config(
  'test.other_secret',
  (select plaintext_secret from public.create_agent_credential('17000000-0000-4000-8000-000000000009'::uuid)),
  true
);
-- key_hash is withheld from authenticated at the column-privilege level (by
-- design — see 20260927000001), so the revoked credential's id is captured
-- directly from create_agent_credential()'s own return value rather than
-- re-derived by looking the row up afterward.
select set_config('test.revoked_secret', r.plaintext_secret, true), set_config('test.revoked_id', r.credential_id::text, true)
from public.create_agent_credential('17000000-0000-4000-8000-000000000003'::uuid) r;

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(lives_ok(
  $$ select public.revoke_agent_credential(current_setting('test.revoked_id')::uuid, 'no longer needed') $$,
  'security_admin+ can revoke a runtime credential'));

set local role anon;

select t(throws_ok(
  $$ select * from public.authorize_tool_call('not-a-real-secret-at-all', '17000000-0000-4000-8000-000000000004'::uuid,
       'github.get_issue', 'get_issue', null, '{}'::jsonb, null, 'k-bad-1', null, 'rv1', 'cv1') $$,
  '28000', null, 'an unknown credential is rejected'));

select t(throws_ok(
  format(
    $$ select * from public.authorize_tool_call(%L, '17000000-0000-4000-8000-000000000004'::uuid,
         'github.get_issue', 'get_issue', null, '{}'::jsonb, null, 'k-bad-2', null, 'rv1', 'cv1') $$,
    current_setting('test.revoked_secret')
  ),
  '28000', null, 'a revoked credential is rejected'));

select t(throws_ok(
  format(
    $$ select * from public.authorize_tool_call(%L, '17000000-0000-4000-8000-000000000010'::uuid,
         'github.get_issue', 'get_issue', null, '{}'::jsonb, null, 'k-bad-3', null, 'rv1', 'cv1') $$,
    current_setting('test.secret_1')
  ),
  '42501', null, 'a credential cannot be used for a task belonging to a different agent'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(throws_ok(
  format(
    $$ select * from public.authorize_tool_call(%L, '17000000-0000-4000-8000-000000000004'::uuid,
         'github.get_issue', 'get_issue', null, '{}'::jsonb, null, 'k-bad-4', null, 'rv1', 'cv1') $$,
    current_setting('test.secret_1')
  ),
  '42501', null, 'authenticated has no EXECUTE grant on authorize_tool_call at all'));

-- ---------------------------------------------------------------------
-- Task not yet executable: no contract has ever been proposed.
-- ---------------------------------------------------------------------
set local role anon;

select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', null, '{}'::jsonb, null, 'k-pending-1', null, 'rv1', 'cv1')),
  'deny',
  'a task still pending (no contract ever issued) denies every runtime call'));

select t(is(
  (select reason_codes[1] from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', null, '{}'::jsonb, null, 'k-pending-1', null, 'rv1', 'cv1')),
  'TASK_NOT_EXECUTABLE',
  'the reason is TASK_NOT_EXECUTABLE while the task is pending'));

-- Replaying the exact same idempotency key and payload again must return the
-- same decision, not evaluate a second time.
select t(is(
  (select was_replayed from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', null, '{}'::jsonb, null, 'k-pending-1', null, 'rv1', 'cv1')),
  true,
  'an identical retry of a denied request replays the same decision'));

select t(throws_ok(
  $$ select * from public.authorize_tool_call(
       current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
       'github.get_issue', 'get_issue', null, '{"changed":true}'::jsonb, null, 'k-pending-1', null, 'rv1', 'cv1') $$,
  '23505', null, 'reusing an idempotency key with a different payload is rejected'));

-- ---------------------------------------------------------------------
-- Propose and activate a real contract for this task.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';

select t(is(
  (select was_created from public.propose_task_contract(
     '17000000-0000-4000-8000-000000000004'::uuid, '17000000-0000-4000-8000-000000000005'::uuid,
     '{"schemaVersion":1,"items":[
        {"tool":"github.get_issue","constraints":[]},
        {"tool":"github.create_branch","constraints":[{"key":"branch","matches":"fix-*"}],"maxInvocations":2}
      ]}'::jsonb,
     '{"secret-*"}', '{"github.delete_repo"}',
     '{"schemaVersion":1,"maxToolInvocations":5,"expiresInSeconds":3600}'::jsonb,
     '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb,
     'rv1', 'cv1', repeat('a', 64), repeat('b', 64),
     '{"schemaVersion":1,"ok":true,"checks":[]}'::jsonb, '{"schemaVersion":1}'::jsonb)),
  true,
  'a contract is proposed for the runtime fixture task'));

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(lives_ok(
  $$ select public.activate_task_contract(
       (select id from public.task_authority_contracts where task_id = '17000000-0000-4000-8000-000000000004' and version = 1)
     ) $$,
  'the zero-approval contract activates directly'));

select t(is(
  (select status::text from public.tasks where id = '17000000-0000-4000-8000-000000000004'),
  'contract_issued',
  'activation moves the task from pending to contract_issued'));

-- ---------------------------------------------------------------------
-- Runtime evaluation against the now-active contract.
-- ---------------------------------------------------------------------
set local role anon;

select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', 'issue-1', '{}'::jsonb, null, 'k-1', null, 'rv1', 'cv1')),
  'allow',
  'an unconstrained allowed tool is allowed'));

select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.create_branch', 'create_branch', 'fix-1', '{"branch":"fix-1"}'::jsonb, null, 'k-2', null, 'rv1', 'cv1')),
  'allow_constrained',
  'a constrained allowed tool with satisfying arguments is allow_constrained'));

select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.create_branch', 'create_branch', 'release-1', '{"branch":"release-1"}'::jsonb, null, 'k-3', null, 'rv1', 'cv1')),
  'deny',
  'an argument violating the tool''s constraint is denied'));

select t(is(
  (select reason_codes[1] from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.create_branch', 'create_branch', null, '{}'::jsonb, null, 'k-4', null, 'rv1', 'cv1')),
  'ARGUMENTS_UNDERSPECIFIED',
  'a missing constrained argument asks for clarification rather than denying outright'));

select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.create_branch', 'create_branch', null, '{}'::jsonb, null, 'k-4', null, 'rv1', 'cv1')),
  'clarify',
  'the underspecified-argument outcome is clarify, not deny'));

select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.delete_pull_request', 'delete', null, '{}'::jsonb, null, 'k-5', null, 'rv1', 'cv1')),
  'replan',
  'a tool absent from the contract is replan, not deny'));

select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', null, '{"note":"secret-vault"}'::jsonb, null, 'k-6', null, 'rv1', 'cv1')),
  'deny',
  'an argument matching a forbidden resource pattern is denied even though the tool itself is allowed'));

select t(is(
  (select reason_codes[1] from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', null, '{"note":"secret-vault"}'::jsonb, null, 'k-6', null, 'rv1', 'cv1')),
  'FORBIDDEN_RESOURCE',
  'the forbidden-resource denial carries the FORBIDDEN_RESOURCE reason code'));

select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.delete_repo', 'delete_repo', null, '{}'::jsonb, null, 'k-7', null, 'rv1', 'cv1')),
  'deny',
  'an exact forbidden operation is denied even though it is not in the allowed-actions list to begin with'));

select t(is(
  (select reason_codes[1] from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.delete_repo', 'delete_repo', null, '{}'::jsonb, null, 'k-7', null, 'rv1', 'cv1')),
  'FORBIDDEN_OPERATION',
  'the forbidden-operation denial carries the FORBIDDEN_OPERATION reason code'));

select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', 'issue-1', '{}'::jsonb, null, 'k-1', null, 'rv1', 'cv1')),
  'allow',
  'replaying the very first successful call by idempotency key still returns allow, not a fresh evaluation'));

-- Per-action budget: create_branch is capped at 2 by its own maxInvocations.
-- k-2 above already consumed one; one more should succeed, then exhaust it.
select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.create_branch', 'create_branch', 'fix-2', '{"branch":"fix-2"}'::jsonb, null, 'k-8', null, 'rv1', 'cv1')),
  'allow_constrained',
  'create_branch''s second distinct invocation is still within its own 2-call budget'));

select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.create_branch', 'create_branch', 'fix-3', '{"branch":"fix-3"}'::jsonb, null, 'k-9', null, 'rv1', 'cv1')),
  'deny',
  'create_branch''s own budget is exhausted on the third distinct invocation'));

select t(is(
  (select reason_codes[1] from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.create_branch', 'create_branch', 'fix-3', '{"branch":"fix-3"}'::jsonb, null, 'k-9', null, 'rv1', 'cv1')),
  'INVOCATION_LIMIT_REACHED',
  'the per-action exhaustion carries the INVOCATION_LIMIT_REACHED reason code'));

-- Contract-wide budget is 5. Used so far by real (non-replayed) calls:
-- k-1 get_issue, k-2 create_branch, k-3 deny (no reservation), k-4 clarify
-- (no reservation), k-5 replan (no reservation), k-6/k-7 deny (no
-- reservation), k-8 create_branch = 3 consumed. Two more allowed calls
-- reach exactly 5; a third exhausts the whole contract.
select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', 'issue-2', '{}'::jsonb, null, 'k-10', null, 'rv1', 'cv1')),
  'allow',
  'the fourth invocation counted against the contract-wide budget is still allowed'));

select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', 'issue-3', '{}'::jsonb, null, 'k-11', null, 'rv1', 'cv1')),
  'allow',
  'the fifth invocation exactly exhausts the contract-wide budget while still being allowed'));

select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', 'issue-4', '{}'::jsonb, null, 'k-12', null, 'rv1', 'cv1')),
  'deny',
  'a sixth invocation is denied once the contract-wide budget is exhausted'));

select t(is(
  (select reason_codes[1] from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', 'issue-4', '{}'::jsonb, null, 'k-12', null, 'rv1', 'cv1')),
  'INVOCATION_LIMIT_REACHED',
  'the contract-wide exhaustion also carries the INVOCATION_LIMIT_REACHED reason code'));

select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', null, '{}'::jsonb, null, 'k-13', null, 'rv2', 'cv1')),
  'deny',
  'a registry version the caller no longer supports denies the call'));

select t(is(
  (select reason_codes[1] from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', null, '{}'::jsonb, null, 'k-13', null, 'rv2', 'cv1')),
  'UNSUPPORTED_CONTRACT_VERSION',
  'the version-mismatch denial carries the UNSUPPORTED_CONTRACT_VERSION reason code'));

-- ---------------------------------------------------------------------
-- Expiry and revocation both remove runtime authority immediately.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';

select t(is(
  (select was_created from public.propose_task_contract(
     '17000000-0000-4000-8000-000000000004'::uuid, '17000000-0000-4000-8000-000000000005'::uuid,
     '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}'::jsonb,
     '{}', '{}',
     '{"schemaVersion":1,"maxToolInvocations":10,"expiresInSeconds":-100}'::jsonb,
     '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb,
     'rv1', 'cv1', repeat('c', 64), repeat('d', 64),
     '{"schemaVersion":1,"ok":true,"checks":[]}'::jsonb, '{"schemaVersion":1}'::jsonb)),
  true,
  'a second contract version with an already-past expiry is proposed'));

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(lives_ok(
  $$ select public.activate_task_contract(
       (select id from public.task_authority_contracts where task_id = '17000000-0000-4000-8000-000000000004' and version = 2)
     ) $$,
  'the second version activates even though its computed expiry is already in the past'));

set local role anon;
select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', null, '{}'::jsonb, null, 'k-14', null, 'rv1', 'cv1')),
  'deny',
  'contract_status = active is not sufficient once expires_at has passed'));

select t(is(
  (select reason_codes[1] from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', null, '{}'::jsonb, null, 'k-14', null, 'rv1', 'cv1')),
  'CONTRACT_NOT_CURRENTLY_ACTIVE',
  'the expired-but-active denial is distinguished from having no contract at all'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(lives_ok(
  $$ select public.revoke_task_contract(
       (select id from public.task_authority_contracts where task_id = '17000000-0000-4000-8000-000000000004' and version = 2),
       'no longer needed for this fixture'
     ) $$,
  'the expired contract can still be revoked explicitly'));

set local role anon;
select t(is(
  (select outcome::text from public.authorize_tool_call(
     current_setting('test.secret_1'), '17000000-0000-4000-8000-000000000004'::uuid,
     'github.get_issue', 'get_issue', null, '{}'::jsonb, null, 'k-15', null, 'rv1', 'cv1')),
  'deny',
  'once revoked, the task has no active contract at all and every call is denied'));
