-- Part 3B: activate_task_contract() / decide_contract_approval() /
-- revoke_task_contract() / reconcile_expired_contracts() — approval
-- binding, self-approval and distinct-approver enforcement, the single-
-- active-contract-per-task invariant, and authz.contract_is_currently_active()
-- as the one thing anything may trust instead of contract_status alone.
--
-- admin.a (rank 40, admin) already satisfies "security_admin+" by rank
-- without any fixture role change, and is used as the contract submitter so
-- self-approval prevention on the role tier has something real to block.
-- dev.a's own tenant role is temporarily raised to security_admin purely to
-- get a *third*, non-submitter, non-owner.a principal for the second
-- required role slot — this suite runs in its own rolled-back transaction
-- (see scripts/db-test.mjs), so the change never persists.

select plan(37);

set local role postgres;

-- Principals linked to real auth ids for every actor whose identity this
-- suite compares by principal (submitter, task owner, each approver) — the
-- demo-installer's own fixture principals are deliberately never linked to
-- a real auth user (see the design note on best-effort attribution), so
-- self-approval and distinct-approver comparisons would silently compare
-- NULL to NULL and never trigger without these.
insert into public.principals (id, tenant_id, kind, display_name, user_id) values
  ('16000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human',
    'Fixture Task Owner (dev.a)', 'a0000000-0000-4000-8000-000000000003'),
  ('16000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'human',
    'Fixture Submitter (admin.a)', 'a0000000-0000-4000-8000-000000000002'),
  ('16000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'human',
    'Fixture Approver (owner.a)', 'a0000000-0000-4000-8000-000000000001');
insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('16000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'agent-16', 'openai', 'gpt', 'x',
    '16000000-0000-4000-8000-000000000001', 'active');
insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('16000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
    '16000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000001', 'Fixture task 16', 'pending');
insert into public.plans (id, tenant_id, task_id, version, input_hash) values
  ('16000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
    '16000000-0000-4000-8000-000000000003', 1, repeat('9', 64));

-- A third qualifying security_admin+ principal for the second role slot,
-- distinct from the submitter (admin.a) and the first approver (owner.a).
update public.tenant_memberships
set role = 'security_admin'
where tenant_id = '11111111-1111-4111-8111-111111111111'
  and user_id = 'a0000000-0000-4000-8000-000000000003';

set local role authenticated;

-- Propose a contract requiring one task_owner approval and two distinct
-- security_admin+ approvals.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select t(is(
  (select was_created from public.propose_task_contract(
     '16000000-0000-4000-8000-000000000003'::uuid, '16000000-0000-4000-8000-000000000004'::uuid,
     '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}'::jsonb, '{}', '{}',
     '{"schemaVersion":1,"maxToolInvocations":1,"expiresInSeconds":3600}'::jsonb,
     '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb,
     '{"schemaVersion":1,"items":[
        {"kind":"task_owner","count":1,"selfApprovalAllowed":true,"reasons":["owner must confirm"]},
        {"kind":"role","role":"security_admin","count":2,"selfApprovalAllowed":false,"reasons":["irreversible"]}
      ]}'::jsonb,
     'rv1', 'cv1', repeat('a',64), repeat('b',64),
     '{"schemaVersion":1,"ok":true,"checks":[]}'::jsonb, '{"schemaVersion":1}'::jsonb)),
  true,
  'admin.a proposes a contract requiring task-owner + two security_admin approvals'));

select t(lives_ok(
  $$ select public.submit_contract_for_approval(
       (select id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 1)
     ) $$,
  'admin.a submits the contract for approval'));

select t(is(
  (select count(*)::int from public.approvals where contract_id =
     (select id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 1)),
  3,
  'exactly three approval slots were created: one task_owner, two security_admin'));

select t(is(
  (select count(distinct (contract_id, contract_version, plan_id, input_hash, output_hash, registry_version, compiler_version))::int
     from public.approvals
     where contract_id = (select id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 1)),
  1,
  'every slot binds to the exact same contract id, version, plan id, hashes, registry and compiler version'));

-- Stashed as GUCs while still in a tenant-A-visible session: the upcoming
-- tenant-B session cannot itself resolve these ids via a live subquery —
-- RLS would filter it to NULL before activate_task_contract/
-- decide_contract_approval ever ran, which would raise "not found" for the
-- wrong reason (a NULL argument) rather than actually exercising the
-- function's own role/tenant check.
select set_config('test.contract_v1_id',
  (select id::text from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 1),
  true);
select set_config('test.contract_v1_task_owner_approval_id',
  (select id::text from public.approvals where contract_id = current_setting('test.contract_v1_id')::uuid and required_kind = 'task_owner'),
  true);

-- Cross-tenant abuse, tested here while every v1 slot is still pending:
-- tenant B's owner cannot decide or activate anything scoped to tenant A.
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(throws_ok(
  $$ select public.activate_task_contract(current_setting('test.contract_v1_id')::uuid) $$,
  '42501', null, 'a member of a different tenant cannot activate this contract'));

select t(throws_ok(
  $$ select public.decide_contract_approval(current_setting('test.contract_v1_task_owner_approval_id')::uuid, 'approved', null) $$,
  '42501', null, 'a member of a different tenant cannot decide an approval scoped to tenant A'));

-- Self-approval prevention: admin.a (the submitter) qualifies as
-- security_admin+ by rank but must not be able to approve that tier.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select t(throws_ok(
  $$ select public.decide_contract_approval(
       (select id from public.approvals where contract_id =
          (select id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 1)
        and required_kind = 'role' and slot_index = 0),
       'approved', null
     ) $$,
  '42501', null, 'the submitter cannot approve a security_admin slot they otherwise qualify for'));

-- A non-owner (owner.a is not the task's own principal) cannot satisfy the task_owner slot.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(throws_ok(
  $$ select public.decide_contract_approval(
       (select id from public.approvals where contract_id =
          (select id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 1)
        and required_kind = 'task_owner'),
       'approved', null
     ) $$,
  '42501', null, 'only the task''s own owner may satisfy the task_owner slot'));

-- owner.a approves the first security_admin slot.
select t(lives_ok(
  $$ select public.decide_contract_approval(
       (select id from public.approvals where contract_id =
          (select id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 1)
        and required_kind = 'role' and slot_index = 0),
       'approved', null
     ) $$,
  'owner.a (security_admin+) approves the first role slot'));

-- Distinct-approver enforcement: owner.a cannot also approve the second slot of the same tier.
select t(throws_ok(
  $$ select public.decide_contract_approval(
       (select id from public.approvals where contract_id =
          (select id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 1)
        and required_kind = 'role' and slot_index = 1),
       'approved', null
     ) $$,
  '42501', null, 'the same principal cannot fill a second slot of the same requirement tier alone'));

-- A distinct, non-submitter security_admin+ principal (dev.a, temporarily promoted) fills slot 1.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(lives_ok(
  $$ select public.decide_contract_approval(
       (select id from public.approvals where contract_id =
          (select id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 1)
        and required_kind = 'role' and slot_index = 1),
       'approved', null
     ) $$,
  'a distinct, non-submitter security_admin+ principal fills the second role slot'));

-- Activation blocked while the task_owner slot is still pending.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(throws_ok(
  $$ select public.activate_task_contract(
       (select id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 1)
     ) $$,
  '23514', null, 'activation is refused while any required slot is still pending'));

-- Direct PostgREST-style UPDATE cannot resolve a contract-bound approval,
-- even for a security_admin+ member — decide_contract_approval() is the
-- only path, exactly like activation has no raw-UPDATE path (test 14 #9).
-- RLS filters the target row instead of raising: the UPDATE "succeeds"
-- with zero rows affected, so the check here is that the row is still
-- pending afterward, not that an exception was thrown.
update public.approvals set status = 'approved' where id = current_setting('test.contract_v1_task_owner_approval_id')::uuid;
select t(is(
  (select status::text from public.approvals where id = current_setting('test.contract_v1_task_owner_approval_id')::uuid),
  'pending',
  'a raw authenticated UPDATE cannot resolve a contract-bound approval — RLS restricts UPDATE to decision-bound rows only'));

-- dev.a, the task's own principal, approves the task_owner slot (their role
-- was temporarily raised, but this check is by principal identity, not role).
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(lives_ok(
  $$ select public.decide_contract_approval(
       (select id from public.approvals where contract_id =
          (select id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 1)
        and required_kind = 'task_owner'),
       'approved', null
     ) $$,
  'the task''s own principal approves the task_owner slot'));

-- Activation requires admin+; owner.a qualifies.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(lives_ok(
  $$ select public.activate_task_contract(
       (select id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 1)
     ) $$,
  'owner.a (admin+) activates the contract once every slot is approved'));

select t(is(
  (select contract_status::text from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 1),
  'active',
  'the contract is now active'));

select t(is(
  (select count(*)::int from public.task_authority_contracts
     where task_id = '16000000-0000-4000-8000-000000000003' and contract_status = 'active'),
  1,
  'exactly one active contract exists for this task'));

-- A second, zero-approval contract version proposed and activated for the
-- same task must supersede the first, never coexist with it.
select t(is(
  (select was_created from public.propose_task_contract(
     '16000000-0000-4000-8000-000000000003'::uuid, '16000000-0000-4000-8000-000000000004'::uuid,
     '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}'::jsonb, '{}', '{}',
     '{"schemaVersion":1,"maxToolInvocations":1,"expiresInSeconds":3600}'::jsonb,
     '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb,
     '{"schemaVersion":1,"items":[]}'::jsonb,
     'rv1', 'cv1', repeat('e',64), repeat('f',64),
     '{"schemaVersion":1,"ok":true,"checks":[]}'::jsonb, '{"schemaVersion":1}'::jsonb)),
  true,
  'a second, zero-approval contract version is proposed for the same task'));

select t(lives_ok(
  $$ select public.activate_task_contract(
       (select id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 2)
     ) $$,
  'the zero-approval version 2 activates directly from proposed, with no submission step'));

select t(is(
  (select contract_status::text from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 1),
  'superseded',
  'version 1 was automatically superseded by version 2''s activation'));

select t(is(
  (select superseded_by_contract_id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 1),
  (select id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 2),
  'version 1 records exactly which contract superseded it'));

select t(is(
  (select count(*)::int from public.task_authority_contracts
     where task_id = '16000000-0000-4000-8000-000000000003' and contract_status = 'active'),
  1,
  'still exactly one active contract for this task after supersession'));

-- The single-active-per-task invariant is enforced at the storage layer,
-- independent of any RPC's own logic: even a superuser cannot force a
-- second row to 'active' for the same task.
set local role postgres;
select set_config('authority.allow_demo_purge', 'on', true);
select t(throws_ok(
  $$ update public.task_authority_contracts set contract_status = 'active',
       activated_at = now(), expires_at = now() + interval '1 hour'
     where task_id = '16000000-0000-4000-8000-000000000003' and version = 1 $$,
  '23505', null,
  'the partial unique index refuses a second active contract for the same task, even for postgres with the demo-purge flag on'));
select set_config('authority.allow_demo_purge', 'off', true);
set local role authenticated;

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- Revocation: active -> revoked, and revoked never counts as currently active.
select t(lives_ok(
  $$ select public.revoke_task_contract(
       (select id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 2),
       'no longer needed'
     ) $$,
  'owner.a (security_admin+) revokes the active contract'));

select t(is(
  (select contract_status::text from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 2),
  'revoked',
  'version 2 is now revoked'));

-- authz.contract_is_currently_active(): the one thing anything may trust
-- instead of contract_status alone — false for every non-active status,
-- and false for a stored "active" whose expires_at has already passed.
select t(is(authz.contract_is_currently_active('proposed', null), false, 'proposed is never currently active'));
select t(is(authz.contract_is_currently_active('rejected', null), false, 'rejected is never currently active'));
select t(is(authz.contract_is_currently_active('revoked', null), false, 'revoked is never currently active'));
select t(is(authz.contract_is_currently_active('expired', null), false, 'expired is never currently active'));
select t(is(authz.contract_is_currently_active('superseded', null), false, 'superseded is never currently active'));
select t(is(authz.contract_is_currently_active('active', null), true, 'active with no expiry is currently active'));
select t(is(authz.contract_is_currently_active('active', now() + interval '1 hour'), true, 'active with a future expiry is currently active'));
select t(is(authz.contract_is_currently_active('active', now() - interval '1 minute'), false,
  'a stored "active" status whose expires_at has already passed is not currently active — status alone is not sufficient'));

-- reconcile_expired_contracts(): belt, not suspenders — flips a genuinely
-- past-due active row, scoped to the caller's own tenant. A fresh version 3
-- is proposed and activated rather than reusing version 2 (already revoked
-- above): a row that is simultaneously "active" and carries a leftover
-- revoked_at could only ever exist via an artificial test shortcut, and the
-- immutability trigger correctly refuses to transition one — proving that
-- would only be testing this suite's own fixture construction, not
-- reconcile_expired_contracts() itself.
select t(is(
  (select was_created from public.propose_task_contract(
     '16000000-0000-4000-8000-000000000003'::uuid, '16000000-0000-4000-8000-000000000004'::uuid,
     '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]}]}'::jsonb, '{}', '{}',
     '{"schemaVersion":1,"maxToolInvocations":1,"expiresInSeconds":3600}'::jsonb,
     '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb,
     '{"schemaVersion":1,"items":[]}'::jsonb,
     'rv1', 'cv1', repeat('1',64), repeat('2',64),
     '{"schemaVersion":1,"ok":true,"checks":[]}'::jsonb, '{"schemaVersion":1}'::jsonb)),
  true,
  'a third, zero-approval contract version is proposed for the reconcile test'));

select t(lives_ok(
  $$ select public.activate_task_contract(
       (select id from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 3)
     ) $$,
  'version 3 activates cleanly'));

set local role postgres;
select set_config('authority.allow_demo_purge', 'on', true);
update public.task_authority_contracts
set expires_at = now() - interval '1 hour'
where task_id = '16000000-0000-4000-8000-000000000003' and version = 3;
select set_config('authority.allow_demo_purge', 'off', true);
set local role authenticated;

select t(isnt(
  (select count(*)::int from public.reconcile_expired_contracts()),
  null,
  'reconcile_expired_contracts runs for an authenticated caller'));

select t(is(
  (select contract_status::text from public.task_authority_contracts where task_id = '16000000-0000-4000-8000-000000000003' and version = 3),
  'expired',
  'the past-due active contract was reconciled to expired'));
