-- propose_task_contract() / submit_contract_for_approval() / reject_contract():
-- authorization, idempotency/compilation-identity, and the corrected
-- lifecycle transition trigger against the real contract_status enum.
--
-- Run only after migration 20260925000001 (the enum widening) has actually
-- committed — by the time this suite runs in the real deploy sequence, it
-- has, since migrations apply and commit in order. The trigger's mechanics
-- were independently verified pre-deployment via a faithful mimic using a
-- throwaway enum type (see the completion report) — this suite is the
-- permanent verification against the real table and real enum values.

select plan(16);

-- Linked to dev.a's own auth id, so submit_contract_for_approval's
-- best-effort principal lookup actually finds one — proving the mechanism
-- populates submitted_by_principal_id when a principal exists, not merely
-- that it tolerates one being absent (see 20260925000009's relaxation).
insert into public.principals (id, tenant_id, kind, display_name, user_id) values
  ('10000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human', 'Fixture Principal G',
    'a0000000-0000-4000-8000-000000000003');
insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('10000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'agent-g', 'openai', 'gpt', 'x',
    '10000000-0000-4000-8000-000000000001', 'active');
insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('10000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Fixture task G', 'pending');
insert into public.plans (id, tenant_id, task_id, version, input_hash) values
  ('10000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-000000000003', 1, repeat('9', 64));

set local role authenticated;

-- Non-member and insufficient-role rejection, mirroring the same regression
-- class already covered for terminate_task/create_task/create_candidate_plan.
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(throws_ok(
  $$ select public.propose_task_contract('10000000-0000-4000-8000-000000000003'::uuid, '10000000-0000-4000-8000-000000000004'::uuid,
       '{"schemaVersion":1,"items":[]}'::jsonb, '{}', '{}', '{"schemaVersion":1,"maxToolInvocations":1,"expiresInSeconds":60}'::jsonb,
       '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb, 'rv1', 'cv1', repeat('a',64), repeat('b',64),
       '{"schemaVersion":1,"ok":true,"checks":[]}'::jsonb, '{"schemaVersion":1}'::jsonb) $$,
  '42501', null, 'a non-member cannot propose a contract for this task'));

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}';
select t(throws_ok(
  $$ select public.propose_task_contract('10000000-0000-4000-8000-000000000003'::uuid, '10000000-0000-4000-8000-000000000004'::uuid,
       '{"schemaVersion":1,"items":[]}'::jsonb, '{}', '{}', '{"schemaVersion":1,"maxToolInvocations":1,"expiresInSeconds":60}'::jsonb,
       '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb, 'rv1', 'cv1', repeat('a',64), repeat('b',64),
       '{"schemaVersion":1,"ok":true,"checks":[]}'::jsonb, '{"schemaVersion":1}'::jsonb) $$,
  '42501', null, 'a viewer (insufficient role) cannot propose a contract'));

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';

-- Happy path.
select t(is(
  (select was_created from public.propose_task_contract('10000000-0000-4000-8000-000000000003'::uuid, '10000000-0000-4000-8000-000000000004'::uuid,
     '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}'::jsonb, '{}', '{}',
     '{"schemaVersion":1,"maxToolInvocations":1,"expiresInSeconds":60}'::jsonb,
     '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb,
     'github-demo-2026-09-23', 'authority-compiler-2026-09-25', repeat('a',64), repeat('b',64),
     '{"schemaVersion":1,"ok":true,"checks":[]}'::jsonb, '{"schemaVersion":1}'::jsonb)),
  true,
  'a developer proposes a contract successfully'));

select t(is(
  (select contract_status::text from public.task_authority_contracts where task_id = '10000000-0000-4000-8000-000000000003'),
  'proposed',
  'the new contract starts in the proposed state, never active'));

select t(is(
  (select count(*)::int from public.contract_compilations where task_id = '10000000-0000-4000-8000-000000000003'),
  1,
  'exactly one compilation audit row was inserted atomically with the contract'));

-- Idempotent retry: identical compilation identity, identical output -> returns existing.
select t(is(
  (select was_created from public.propose_task_contract('10000000-0000-4000-8000-000000000003'::uuid, '10000000-0000-4000-8000-000000000004'::uuid,
     '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}'::jsonb, '{}', '{}',
     '{"schemaVersion":1,"maxToolInvocations":1,"expiresInSeconds":60}'::jsonb,
     '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb,
     'github-demo-2026-09-23', 'authority-compiler-2026-09-25', repeat('a',64), repeat('b',64),
     '{"schemaVersion":1,"ok":true,"checks":[]}'::jsonb, '{"schemaVersion":1}'::jsonb)),
  false,
  'an identical compilation identity with an identical output hash returns the existing contract'));

-- Same identity, different output hash -> deterministic-invariant violation, loud failure.
select t(throws_ok(
  $$ select public.propose_task_contract('10000000-0000-4000-8000-000000000003'::uuid, '10000000-0000-4000-8000-000000000004'::uuid,
       '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}'::jsonb, '{}', '{}',
       '{"schemaVersion":1,"maxToolInvocations":1,"expiresInSeconds":60}'::jsonb,
       '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb,
       'github-demo-2026-09-23', 'authority-compiler-2026-09-25', repeat('a',64), repeat('c',64),
       '{"schemaVersion":1,"ok":true,"checks":[]}'::jsonb, '{"schemaVersion":1}'::jsonb) $$,
  '55000', null, 'the same compilation identity producing a different output hash raises loudly, never silently returns either row'));

-- A different compiler_version is a different identity: creates a new version.
select t(is(
  (select version from public.propose_task_contract('10000000-0000-4000-8000-000000000003'::uuid, '10000000-0000-4000-8000-000000000004'::uuid,
     '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}'::jsonb, '{}', '{}',
     '{"schemaVersion":1,"maxToolInvocations":1,"expiresInSeconds":60}'::jsonb,
     '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb,
     'github-demo-2026-09-23', 'authority-compiler-2026-09-26-v2', repeat('a',64), repeat('d',64),
     '{"schemaVersion":1,"ok":true,"checks":[]}'::jsonb, '{"schemaVersion":1}'::jsonb)),
  2,
  'a different compiler_version is a different identity and creates a new contract version'));

-- Raw authenticated UPDATE cannot activate a contract (no grant exists at all).
select t(throws_ok(
  $$ update public.task_authority_contracts set contract_status = 'active'
     where task_id = '10000000-0000-4000-8000-000000000003' and version = 1 $$,
  '42501', null, 'a raw authenticated UPDATE cannot activate a contract — no UPDATE grant exists on this table'));

-- submit_contract_for_approval: proposed -> awaiting_approval, records submitter.
select t(lives_ok(
  $$ select public.submit_contract_for_approval(
       (select id from public.task_authority_contracts where task_id = '10000000-0000-4000-8000-000000000003' and version = 1)
     ) $$,
  'a developer can submit their own proposed contract for approval'));

select t(is(
  (select contract_status::text from public.task_authority_contracts where task_id = '10000000-0000-4000-8000-000000000003' and version = 1),
  'awaiting_approval',
  'the contract is now awaiting_approval'));

select t(isnt(
  (select submitted_by_principal_id from public.task_authority_contracts where task_id = '10000000-0000-4000-8000-000000000003' and version = 1),
  null,
  'submitted_by_principal_id was recorded, derived from the caller, never from an argument'));

-- reject_contract from awaiting_approval requires security_admin+; developer is insufficient here.
select t(throws_ok(
  $$ select public.reject_contract(
       (select id from public.task_authority_contracts where task_id = '10000000-0000-4000-8000-000000000003' and version = 1),
       'not good enough'
     ) $$,
  '42501', null, 'a developer cannot reject a contract that is already awaiting_approval — security_admin+ required'));

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
-- owner.a: security_admin+ satisfied.
select t(lives_ok(
  $$ select public.reject_contract(
       (select id from public.task_authority_contracts where task_id = '10000000-0000-4000-8000-000000000003' and version = 1),
       'not aligned with policy'
     ) $$,
  'an owner (security_admin+) can reject a contract awaiting approval'));

select t(is(
  (select contract_status::text from public.task_authority_contracts where task_id = '10000000-0000-4000-8000-000000000003' and version = 1),
  'rejected',
  'the contract is now rejected'));

-- No current Part 3A RPC ever produces 'active'.
select t(is(
  (select count(*)::int from public.task_authority_contracts where task_id = '10000000-0000-4000-8000-000000000003' and contract_status = 'active'),
  0,
  'no contract created via this task ever reached active through any Part 3A RPC'));
