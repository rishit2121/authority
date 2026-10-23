-- Part 7: GitHub connector schema. Tenant isolation and RLS, client write lockout, the two-phase
-- capability state machine, receipts, installation constraints, runtime approvals, and the
-- removal of the legacy authorization function — all against the real deployed schema.

select plan(111);

set local role postgres;

-- Independent of whatever GitHub state the shared dev project currently holds (rolled back with the suite).
select set_config('authority.allow_demo_purge', 'on', true);
delete from public.github_execution_receipts where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.capability_reservations where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.task_repository_bindings where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.github_repositories where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.github_install_states where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.github_installations where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
select set_config('authority.allow_demo_purge', 'off', true);

insert into public.principals (id, tenant_id, kind, display_name, user_id) values
  ('20000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human', 'Task Owner (dev.a)', 'a0000000-0000-4000-8000-000000000003'),
  ('20000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'human', 'Approver (owner.a)', 'a0000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'human', 'Approver (admin.a)', 'a0000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'human', 'Owner B', 'b0000000-0000-4000-8000-000000000001');
insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('20000000-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111', 'agent-20', 'openai', 'gpt', 'x', '20000000-0000-4000-8000-000000000001', 'active'),
  ('20000000-0000-4000-8000-0000000000b2', '22222222-2222-4222-8222-222222222222', 'agent-20-b', 'openai', 'gpt', 'x', '20000000-0000-4000-8000-0000000000b1', 'active');
insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('20000000-0000-4000-8000-000000000020', '11111111-1111-4111-8111-111111111111', '20000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000001', 'GitHub task', 'contract_issued'),
  ('20000000-0000-4000-8000-000000000021', '11111111-1111-4111-8111-111111111111', '20000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000001', 'GitHub task 2', 'contract_issued'),
  ('20000000-0000-4000-8000-000000000022', '11111111-1111-4111-8111-111111111111', '20000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000001', 'GitHub task 3', 'contract_issued');

create function public.t20_activate(p_task uuid, p_id uuid, p_max int) returns void
language sql security definer set search_path = '' as $$
  insert into public.task_authority_contracts (
    id, tenant_id, task_id, version, spec_version, allowed_actions, forbidden_resources, forbidden_operations,
    ephemeral_limits, contract_status, registry_version, compiler_version, input_hash, output_hash,
    data_flow_bindings, required_approvals, activated_at, expires_at, required_approvals_spec, demo_key)
  values (p_id, '11111111-1111-4111-8111-111111111111', p_task, 1, 'v1',
    '{"schemaVersion":1,"items":[{"tool":"github.get_issue","constraints":[]},{"tool":"github.create_branch","constraints":[]},{"tool":"github.delete_branch","constraints":[]}]}'::jsonb,
    '{}', '{}', jsonb_build_object('schemaVersion', 1, 'maxToolInvocations', p_max, 'expiresInSeconds', 3600),
    'active', 'rv1', 'cv1', repeat('9', 64), repeat('8', 64), '{"schemaVersion":1,"refs":[]}'::jsonb,
    '{"schemaVersion":1,"items":[]}'::jsonb, now(), now() + interval '1 hour', '{"schemaVersion":1,"items":[]}'::jsonb, 't20:' || p_id::text)
$$;
select public.t20_activate('20000000-0000-4000-8000-000000000020', '20000000-0000-4000-8000-0000000000c1', 40);
select public.t20_activate('20000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-0000000000c2', 40);
select public.t20_activate('20000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-0000000000c3', 40);

-- GitHub installation, two repositories, task bindings (tenant A) and an installation for tenant B.
insert into public.github_installations (id, tenant_id, github_installation_id, mode, account_login, account_type, github_account_id,
  repository_selection, granted_permissions, status) values
  ('20000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 7001, 'mock', 'acme-t20', 'Organization', 1, 'selected',
   '{"contents":"write","issues":"read","metadata":"read","pull_requests":"write"}', 'active'),
  ('20000000-0000-4000-8000-0000000000d2', '22222222-2222-4222-8222-222222222222', 7002, 'mock', 'globex-t20', 'Organization', 2, 'selected', '{}', 'active');
insert into public.github_repositories (id, tenant_id, installation_row_id, github_repository_id, owner, name, default_branch, is_private, allowed, allowed_at) values
  ('20000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', '20000000-0000-4000-8000-0000000000d1', 70011, 'acme-t20', 'widgets', 'main', true, true, now()),
  ('20000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', '20000000-0000-4000-8000-0000000000d1', 70012, 'acme-t20', 'secret', 'main', true, false, null),
  ('20000000-0000-4000-8000-0000000000e3', '22222222-2222-4222-8222-222222222222', '20000000-0000-4000-8000-0000000000d2', 70021, 'globex-t20', 'ledger', 'main', true, true, now());
insert into public.task_repository_bindings (tenant_id, task_id, repository_id, bound_by_principal_id) values
  ('11111111-1111-4111-8111-111111111111', '20000000-0000-4000-8000-000000000020', '20000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-000000000001'),
  ('11111111-1111-4111-8111-111111111111', '20000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-000000000001');

create function public.t20_auth(p_key text, p_tool text default 'github.get_issue', p_args jsonb default '{}'::jsonb,
  p_task uuid default '20000000-0000-4000-8000-000000000020', p_resource text default 'acme-t20/widgets', p_uses int default 1,
  p_risk text default 'low')
returns table (status text, final public.authorization_outcome, cap uuid, tool_request uuid, reasons text[])
language sql security definer set search_path = '' as $$
  select c.r_status, c.r_final_outcome, c.r_capability_id, c.r_tool_request_id, c.r_reason_codes
  from gateway.commit_authorization(current_setting('test.secret_a'), p_task, p_tool, 'op', p_resource, p_args,
    '{"schemaVersion":1,"count":0,"truncated":false,"entries":[]}'::jsonb, null, p_key, 'rv1', 'cv1', p_risk, p_uses,
    encode(extensions.digest('authcap_v1_' || p_key, 'sha256'), 'hex'), null, null, null, null, null, null, null, null, null, null, null, null,
    't20', false) c
$$;
create function public.t20_reserve(p_key text, p_token_key text, p_tool text default 'github.get_issue', p_args jsonb default '{}'::jsonb,
  p_resource text default 'acme-t20/widgets', p_mode text default 'mock')
returns table (result text, reason text, exec uuid, repo text, gh bigint, prev text)
language sql security definer set search_path = '' as $$
  select r.rs_result, r.rs_reason_code, r.rs_execution_id, r.rs_repository, r.rs_github_installation_id, r.rs_prev_category
  from gateway.reserve_execution(current_setting('test.secret_a'), encode(extensions.digest('authcap_v1_' || p_token_key, 'sha256'), 'hex'),
    p_tool, 'op', p_resource, p_args, p_key, p_mode, 45) r
$$;
create function public.t20_tok(p_key text) returns text language sql stable set search_path = '' as $$
  select encode(extensions.digest('authcap_v1_' || p_key, 'sha256'), 'hex') $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select set_config('test.secret_a', r.plaintext_secret, true) from public.create_agent_credential('20000000-0000-4000-8000-000000000010'::uuid) r;
set local role postgres;

-- =====================================================================
-- 1. The legacy function is gone; new tables are RLS-protected and client-read-only.
-- =====================================================================
select t(hasnt_function('public', 'authorize_tool_call', 'the Part 4 authorize_tool_call function no longer exists'));
select t(ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('github_installations','github_repositories','github_install_states','task_repository_bindings',
    'capability_reservations','github_execution_receipts','runtime_approval_requests','runtime_approval_decisions','github_webhook_deliveries')),
  'row level security is enabled on every new table'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}'; -- viewer.a
select t(is((select count(*)::int from public.github_installations), 1, 'a tenant member sees its own installation'));
select t(is((select count(*)::int from public.github_installations where tenant_id = '22222222-2222-4222-8222-222222222222'), 0, 'and none of another tenant''s'));
select t(is((select count(*)::int from public.github_repositories), 2, 'a member sees only its tenant''s repositories'));
select t(throws_ok($$ select * from public.github_install_states $$, '42501', null, 'install states (nonce hashes) are not readable by clients at all'));
select t(throws_ok($$ select * from public.github_webhook_deliveries $$, '42501', null, 'webhook deliveries are not readable by clients'));
select t(throws_ok($$ insert into public.github_installations (tenant_id, github_installation_id, mode, account_login, account_type, github_account_id, repository_selection)
  values ('11111111-1111-4111-8111-111111111111', 999, 'live', 'x', 'User', 1, 'all') $$, '42501', null, 'a client cannot map an installation to its own tenant'));
select t(throws_ok($$ update public.github_repositories set allowed = true $$, '42501', null, 'a client cannot edit the repository allowlist directly'));
select t(throws_ok($$ insert into public.task_repository_bindings (tenant_id, task_id, repository_id, bound_by_principal_id)
  values ('11111111-1111-4111-8111-111111111111', '20000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'a client cannot bind a task to a repository directly'));
select t(throws_ok($$ insert into public.github_execution_receipts (tenant_id) values ('11111111-1111-4111-8111-111111111111') $$, '42501', null, 'a client cannot forge a receipt'));
select t(throws_ok($$ insert into public.capability_reservations (tenant_id) values ('11111111-1111-4111-8111-111111111111') $$, '42501', null, 'a client cannot forge a reservation'));
select t(throws_ok($$ insert into public.runtime_approval_requests (tenant_id) values ('11111111-1111-4111-8111-111111111111') $$, '42501', null, 'a client cannot forge an approval request'));
select t(throws_ok($$ select gateway.reserve_execution('x', repeat('a', 64), 'github.get_issue', 'op', null, '{}'::jsonb, 'k', 'mock', 45) $$, '42501', null, 'a signed-in user cannot reach gateway.reserve_execution'));
select t(throws_ok($$ select gateway.github_disconnect('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-0000000000d1'::uuid) $$,
  '42501', null, 'nor the installation-administration functions'));
set local role anon;
select t(throws_ok($$ select * from public.github_installations $$, '42501', null, 'anon reads nothing'));
select t(throws_ok($$ select public.decide_runtime_approval('20000000-0000-4000-8000-0000000000f1'::uuid, 'approve', 'x') $$, '42501', null, 'anon cannot decide an approval'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}'; -- owner.b
select t(is((select count(*)::int from public.github_installations), 1, 'tenant B sees exactly its own installation'));
select t(is((select github_installation_id::int from public.github_installations), 7002, 'and it is not tenant A''s'));
select t(is((select count(*)::int from public.task_repository_bindings), 0, 'tenant B sees none of tenant A''s task bindings'));
set local role postgres;

-- =====================================================================
-- 2. Installation constraints.
-- =====================================================================
select t(throws_ok($$ insert into public.github_installations (tenant_id, github_installation_id, mode, account_login, account_type, github_account_id, repository_selection)
  values ('22222222-2222-4222-8222-222222222222', 7001, 'mock', 'thief', 'User', 3, 'all') $$, '23505', null, 'an installation id can belong to only one tenant, ever'));
select t(throws_ok($$ insert into public.github_installations (tenant_id, github_installation_id, mode, account_login, account_type, github_account_id, repository_selection)
  values ('11111111-1111-4111-8111-111111111111', 7003, 'mock', 'second', 'User', 3, 'all') $$, '23505', null, 'a tenant can have only one live installation'));
select t(throws_ok($$ update public.github_installations set status = 'disconnected' where id = '20000000-0000-4000-8000-0000000000d2' $$, '23514', null,
  'a disconnected installation must record when it was disconnected'));
select t(throws_ok($$ insert into public.github_installations (tenant_id, github_installation_id, mode, account_login, account_type, github_account_id, repository_selection, status)
  values ('22222222-2222-4222-8222-222222222222', 7004, 'sandbox', 'x', 'User', 4, 'all', 'disconnected') $$, '23514', null, 'an installation mode must be mock or live'));
select t(throws_ok($$ insert into public.github_repositories (tenant_id, installation_row_id, github_repository_id, owner, name, default_branch, is_private)
  values ('22222222-2222-4222-8222-222222222222', '20000000-0000-4000-8000-0000000000d1', 70099, 'x', 'y', 'main', true) $$, '23503', null,
  'a repository cannot be attached to another tenant''s installation'));
select t(throws_ok($$ insert into public.task_repository_bindings (tenant_id, task_id, repository_id, bound_by_principal_id)
  values ('11111111-1111-4111-8111-111111111111', '20000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-0000000000e3', '20000000-0000-4000-8000-000000000001') $$, '23503', null,
  'a task cannot be bound to another tenant''s repository'));
select t(throws_ok($$ update public.task_repository_bindings set repository_id = '20000000-0000-4000-8000-0000000000e2' $$, '23514', null, 'a task binding is immutable'));
select t(throws_ok($$ delete from public.task_repository_bindings $$, '23514', null, 'and cannot be deleted'));

-- =====================================================================
-- 3. Two-phase capability consumption.
-- =====================================================================
select t(is((select status from public.t20_auth('a-1')), 'ok', 'a capability is issued for a connector tool'));
select t(is((select result from public.t20_reserve('r-1', 'a-1')), 'reserved', 'the first reservation succeeds'));
select set_config('t20.exec1', (select exec::text from public.t20_reserve('r-1', 'a-1')), true);
select t(is((select reason from public.t20_reserve('r-2', 'a-1')), 'RESERVATION_IN_PROGRESS', 'a single-use capability cannot be reserved twice at once'));
select t(is((select result from public.t20_reserve('r-1', 'a-1')), 'in_progress', 'the same key while in flight reports in_progress and the same execution'));
select t(is((select exec::text from public.t20_reserve('r-1', 'a-1')), current_setting('t20.exec1'), 'with the same execution id'));
select t(is((select uses || '/' || reserved_uses from public.capability_tokens where token_hash = public.t20_tok('a-1')), '0/1', 'the use is held, not spent'));
select t(is((select reason from public.t20_reserve('r-3', 'a-1', 'github.get_issue', '{"x":1}'::jsonb)), 'RESERVATION_IN_PROGRESS', 'while the only use is held, any other attempt is told to wait (not recorded as a rejection)'));
select t(is((select repo from public.t20_reserve('r-1', 'a-1')), null, 'a repeat reveals nothing new'));

select t(is((select md_status from gateway.mark_dispatched(current_setting('t20.exec1')::uuid, '20000000-0000-4000-8000-000000000010'::uuid)), 'ok', 'dispatch is allowed once'));
select t(is((select md_status from gateway.mark_dispatched(current_setting('t20.exec1')::uuid, '20000000-0000-4000-8000-000000000010'::uuid)), 'already_dispatched', 'and never twice'));
select t(is((select md_status from gateway.mark_dispatched(current_setting('t20.exec1')::uuid, '20000000-0000-4000-8000-000000000099'::uuid)), 'not_found', 'another agent cannot dispatch it'));
select t(throws_ok($$ select gateway.settle_reservation(current_setting('t20.exec1')::uuid, 'released', 'X', null, null, null, null, null, null, null) $$, '55000', null, 'a dispatched execution can never be released'));
select t(is((select f_status from gateway.finish_execution(current_setting('t20.exec1')::uuid, '20000000-0000-4000-8000-000000000099'::uuid,
  'succeeded', null, 'MOCK-1', 2::smallint, '{"schemaVersion":1}'::jsonb, null, null, now(), '{"schemaVersion":1}'::jsonb)), 'not_found', 'only the reserving agent can settle an execution'));
select t(is((select f_status from gateway.finish_execution(current_setting('t20.exec1')::uuid, '20000000-0000-4000-8000-000000000010'::uuid,
  'succeeded', null, 'MOCK-1', 2::smallint, '{"schemaVersion":1}'::jsonb, null, null, now(), '{"schemaVersion":1}'::jsonb)), 'ok', 'the reserving execution settles it'));
select t(is((select f_status from gateway.finish_execution(current_setting('t20.exec1')::uuid, '20000000-0000-4000-8000-000000000010'::uuid,
  'failed', 'X', null, null, '{"schemaVersion":1}'::jsonb, null, null, now(), '{"schemaVersion":1}'::jsonb)), 'already_final', 'a settled execution cannot be settled again'));
select t(is((select uses || '/' || reserved_uses || '/' || status from public.capability_tokens where token_hash = public.t20_tok('a-1')), '1/0/consumed', 'consumed only after the confirmed result'));
select t(is((select reason from public.t20_reserve('r-4', 'a-1')), 'CAPABILITY_ALREADY_USED', 'replay after consumption is refused'));
select t(is((select result || ':' || prev from public.t20_reserve('r-1', 'a-1')), 'replayed:consumed', 'the same key replays the recorded outcome'));
select t(is((select count(*)::int from public.github_execution_receipts where execution_id = current_setting('t20.exec1')::uuid and result_category = 'succeeded'), 1, 'exactly one receipt was written'));

-- release refunds; failure and indeterminate spend
select public.t20_auth('a-2');
select set_config('t20.exec2', (select exec::text from public.t20_reserve('r-5', 'a-2')), true);
select t(throws_ok($$ select * from gateway.finish_execution(current_setting('t20.exec2')::uuid, '20000000-0000-4000-8000-000000000010'::uuid,
  'succeeded', null, null, 2::smallint, '{"schemaVersion":1}'::jsonb, null, null, now(), '{"schemaVersion":1}'::jsonb) $$, '55000', null, 'an execution that was never dispatched cannot be recorded as succeeded'));
select public.t20_auth('a-3');
select set_config('t20.exec3', (select exec::text from public.t20_reserve('r-6', 'a-3')), true);
select set_config('t20.budget_a3', (select consumed_uses::text from public.capabilities
  where contract_id = '20000000-0000-4000-8000-0000000000c1' and tool = 'github.get_issue'), true);
select gateway.settle_reservation(current_setting('t20.exec3')::uuid, 'released', 'ARGUMENTS_INVALID', null, null, null, null, null, null, null);
select t(is((select uses || '/' || reserved_uses from public.capability_tokens where token_hash = public.t20_tok('a-3')), '0/0', 'a release before dispatch refunds the use'));
select t(is((select status || ':' || revoked_by from public.capability_tokens where token_hash = public.t20_tok('a-3')), 'revoked:system',
  'a single-use GitHub capability released before dispatch is retired (#59, same as connectors since #57)'));
select t(is((select reason from public.t20_reserve('r-7', 'a-3')), 'CAPABILITY_REVOKED', 'so it cannot be reserved again'));
select t(is((select consumed_uses from public.capabilities where contract_id = '20000000-0000-4000-8000-0000000000c1' and tool = 'github.get_issue'),
  current_setting('t20.budget_a3')::int - 1, 'and its one use is returned to the step''s budget'));

select public.t20_auth('a-4');
select set_config('t20.exec4', (select exec::text from public.t20_reserve('r-8', 'a-4')), true);
select gateway.mark_dispatched(current_setting('t20.exec4')::uuid, '20000000-0000-4000-8000-000000000010'::uuid);
select gateway.finish_execution(current_setting('t20.exec4')::uuid, '20000000-0000-4000-8000-000000000010'::uuid, 'indeterminate', 'TRANSPORT_TIMEOUT', null, null,
  '{"schemaVersion":1}'::jsonb, null, null, now(), '{"schemaVersion":1}'::jsonb);
select t(is((select uses || '/' || status from public.capability_tokens where token_hash = public.t20_tok('a-4')), '1/consumed', 'an indeterminate write spends the use'));
select t(is((select status from public.capability_reservations where id = current_setting('t20.exec4')::uuid), 'indeterminate', 'and is recorded as indeterminate'));
select t(is((select result || ':' || prev from public.t20_reserve('r-8', 'a-4')), 'replayed:indeterminate', 'an indeterminate execution is never re-run: the key replays it'));

-- lease expiry
select public.t20_auth('a-5');
select set_config('t20.exec5', (select exec::text from public.t20_reserve('r-9', 'a-5')), true);
select public.t20_auth('a-6');
select set_config('t20.exec6', (select exec::text from public.t20_reserve('r-10', 'a-6')), true);
select gateway.mark_dispatched(current_setting('t20.exec6')::uuid, '20000000-0000-4000-8000-000000000010'::uuid);
alter table public.capability_reservations disable trigger capability_reservations_guard;
update public.capability_reservations set reserved_at = now() - interval '3 minutes', lease_expires_at = now() - interval '2 minutes'
  where id in (current_setting('t20.exec5')::uuid, current_setting('t20.exec6')::uuid);
alter table public.capability_reservations enable trigger capability_reservations_guard;
select gateway.reconcile_expired_reservations(50);
select t(is((select status || ':' || reason_code from public.capability_reservations where id = current_setting('t20.exec5')::uuid), 'released:LEASE_EXPIRED_BEFORE_DISPATCH', 'an expired undispatched lease is released'));
select t(is((select status || ':' || reason_code from public.capability_reservations where id = current_setting('t20.exec6')::uuid), 'indeterminate:LEASE_EXPIRED_AFTER_DISPATCH', 'an expired dispatched lease is indeterminate, never silently released'));
select t(is((select uses || '/' || reserved_uses from public.capability_tokens where token_hash = public.t20_tok('a-5')), '0/0', 'the undispatched expiry refunded the use'));
select t(is((select status || ':' || revoked_by from public.capability_tokens where token_hash = public.t20_tok('a-5')), 'revoked:system',
  'a lease that expired before dispatch also retired its single-use GitHub capability'));

-- reservation / receipt guards
select t(throws_ok($$ update public.capability_reservations set status = 'reserved', finished_at = null where id = current_setting('t20.exec1')::uuid $$, '23514', null, 'a settled reservation cannot move back'));
select t(throws_ok($$ update public.capability_reservations set repository_full_name = 'evil/repo' where id = current_setting('t20.exec1')::uuid $$, '23514', null, 'a reservation''s binding is immutable'));
select t(throws_ok($$ delete from public.capability_reservations where id = current_setting('t20.exec1')::uuid $$, '23514', null, 'reservations cannot be deleted'));
select t(throws_ok($$ update public.github_execution_receipts set result_category = 'failed' where execution_id = current_setting('t20.exec1')::uuid $$, '23514', null, 'receipts are immutable'));
select t(throws_ok($$ delete from public.github_execution_receipts $$, '23514', null, 'receipts cannot be deleted'));
select t(throws_ok($$ insert into public.github_execution_receipts (tenant_id, execution_id, task_id, agent_id, capability_id, authorization_decision_id, tool, operation, request_hash, execution_mode, result_category, started_at, finished_at)
  select tenant_id, gen_random_uuid(), task_id, agent_id, capability_id, authorization_decision_id, tool, operation, request_hash, execution_mode, 'failed', now(), now()
  from public.github_execution_receipts limit 1 $$, '23514', null, 'a failure receipt must carry a reason'));
select t(throws_ok($$ update public.capability_tokens set reserved_uses = 2 where token_hash = public.t20_tok('a-4') $$, '23514', null, 'uses + reservations can never exceed the capability''s maximum'));
select t(is((select count(*)::int from public.github_execution_receipts r where r.tenant_id = '22222222-2222-4222-8222-222222222222'), 0, 'tenant B has no receipts from tenant A''s executions'));

-- connector-tool, mode, repository checks at reservation
select public.t20_auth('b-1');
select t(is((select reason from public.t20_reserve('rb-1', 'b-1', 'github.get_issue', '{}'::jsonb, 'acme-t20/widgets', 'live')), 'EXECUTION_MODE_MISMATCH', 'a live execution cannot use a mock installation'));
select t(is((select reason from public.t20_reserve('rb-2', 'b-1', 'github.get_issue', '{}'::jsonb, 'acme-t20/secret')), 'SCOPE_MISMATCH', 'a repository that is not the capability''s resource is refused'));
select public.t20_auth('b-2', 'github.get_issue', '{}'::jsonb, '20000000-0000-4000-8000-000000000020', 'acme-t20/secret');
select t(is((select reason from public.t20_reserve('rb-3', 'b-2', 'github.get_issue', '{}'::jsonb, 'acme-t20/secret')), 'REPOSITORY_NOT_BOUND', 'a repository the task is not bound to is refused'));
select public.t20_auth('b-3', 'github.get_issue', '{}'::jsonb, '20000000-0000-4000-8000-000000000022');
select t(is((select reason from public.t20_reserve('rb-4', 'b-3')), 'REPOSITORY_NOT_BOUND', 'an unbound task cannot execute at all'));
update public.github_repositories set allowed = false, allowed_at = null where id = '20000000-0000-4000-8000-0000000000e1';
select t(is((select reason from public.t20_reserve('rb-5', 'b-1')), 'REPOSITORY_NOT_ALLOWED', 'removing a repository from the allowlist blocks execution immediately'));
update public.github_repositories set allowed = true, allowed_at = now() where id = '20000000-0000-4000-8000-0000000000e1';
update public.github_installations set status = 'permission_drift', health_reasons = array['PERMISSION_EXTRA:administration'] where id = '20000000-0000-4000-8000-0000000000d1';
select t(is((select reason from public.t20_reserve('rb-6', 'b-1')), 'INSTALLATION_UNAVAILABLE', 'a drifted installation blocks execution'));
update public.github_installations set status = 'active', health_reasons = '{}' where id = '20000000-0000-4000-8000-0000000000d1';
select t(is((select result from public.t20_reserve('rb-7', 'b-1')), 'reserved', 'and recovery re-enables it'));

-- simulated consumption cannot spend a connector capability
select public.t20_auth('c-1');
select t(is((select cs_reason_code from gateway.consume_capability(current_setting('test.secret_a'), public.t20_tok('c-1'), 'github.get_issue', 'op', 'acme-t20/widgets', '{}'::jsonb, 'sim-1')),
  'CONNECTOR_EXECUTION_REQUIRED', 'simulated consumption refuses a connector-executed tool'));

-- =====================================================================
-- 4. Unused budget is returned on revocation.
-- =====================================================================
select public.t20_auth('d-1', 'github.get_issue', '{}'::jsonb, '20000000-0000-4000-8000-000000000021', 'acme-t20/widgets', 3);
select set_config('t20.budget_before', (select consumed_uses::text from public.capabilities where task_id = '20000000-0000-4000-8000-000000000021'), true);
select t(is(current_setting('t20.budget_before'), '3', 'issuing a 3-use capability reserves 3 uses of contract budget'));
select gateway.revoke_capability(current_setting('test.secret_a'), (select id from public.capability_tokens where token_hash = public.t20_tok('d-1')), 'no longer needed');
select t(is((select consumed_uses::int from public.capabilities where task_id = '20000000-0000-4000-8000-000000000021'), 0, 'revoking returns the unused uses to the budget'));
select gateway.revoke_capability(current_setting('test.secret_a'), (select id from public.capability_tokens where token_hash = public.t20_tok('d-1')), 'again');
select t(is((select consumed_uses::int from public.capabilities where task_id = '20000000-0000-4000-8000-000000000021'), 0, 'exactly once'));
select t(is((select budget_released_uses from public.capability_tokens where token_hash = public.t20_tok('d-1')), 3, 'the release is recorded on the capability'));
select t(throws_ok($$ update public.capability_tokens set budget_released_uses = 0 where token_hash = public.t20_tok('d-1') $$, '23514', null, 'released budget only moves forward'));

-- =====================================================================
-- 5. Runtime approvals.
-- =====================================================================
insert into public.semantic_settings (tenant_id, runtime_approval_classes) values ('11111111-1111-4111-8111-111111111111', '{medium,high}')
  on conflict (tenant_id) do update set runtime_approval_classes = '{medium,high}';
select set_config('t20.req_before', (select count(*)::text from public.runtime_approval_requests), true);
select t(is((select final::text from public.t20_auth('p-1', 'github.create_branch', '{"branch":"authority/x/y"}'::jsonb, '20000000-0000-4000-8000-000000000020', 'acme-t20/widgets', 1, 'medium')), 'require_approval', 'a policy class narrows an allow to require_approval'));
select t(is((select cap from public.t20_auth('p-1', 'github.create_branch', '{"branch":"authority/x/y"}'::jsonb, '20000000-0000-4000-8000-000000000020', 'acme-t20/widgets', 1, 'medium')), null, 'and issues no capability'));
select t(is((select count(*)::int from public.runtime_approval_requests where task_id = '20000000-0000-4000-8000-000000000020') , 1, 'exactly one approval request exists for the request, even after a replay'));
select set_config('t20.appr', (select id::text from public.runtime_approval_requests where task_id = '20000000-0000-4000-8000-000000000020'), true);
select t(is((select required_approvals from public.runtime_approval_requests where id = current_setting('t20.appr')::uuid), 1, 'a medium-risk request needs one approval'));
select t(is((select count(*)::int from public.capabilities where task_id = '20000000-0000-4000-8000-000000000020' and tool = 'github.create_branch'), 0, 'no budget was reserved for a request that is not allowed'));
select t(throws_ok($$ update public.runtime_approval_requests set arguments_hash = repeat('0', 64) where id = current_setting('t20.appr')::uuid $$, '23514', null, 'an approval request''s binding is immutable'));
select t(throws_ok($$ update public.runtime_approval_requests set status = 'consumed' where id = current_setting('t20.appr')::uuid $$, '23514', null, 'an approval cannot skip from pending to consumed'));
select t(throws_ok($$ update public.final_decisions set narrowed = false where true $$, '23514', null, 'final decisions stay append-only'));
select t(throws_ok($$ insert into public.final_decisions (tenant_id, task_id, tool_request_id, authorization_decision_id, deterministic_outcome, final_outcome, semantic_mode, semantic_policy, risk_class, composition_reasons, narrowed, gateway_version)
  select tenant_id, task_id, tool_request_id, authorization_decision_id, 'allow', 'deny', 'shadow', 'optional', 'low', '{}', true, 'x' from public.final_decisions limit 1 $$, '23514', null,
  'shadow mode still cannot narrow a decision without an approval-policy reason'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}'; -- dev.a
select t(throws_ok($$ select public.decide_runtime_approval(current_setting('t20.appr')::uuid, 'approve', 'x') $$, '42501', null, 'a developer cannot decide an approval'));
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}'; -- owner.b
select t(throws_ok($$ select public.decide_runtime_approval(current_setting('t20.appr')::uuid, 'approve', 'x') $$, 'P0002', null, 'another tenant cannot even see it'));
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}'; -- owner.a
select t(is((select public.decide_runtime_approval(current_setting('t20.appr')::uuid, 'approve', 'ok')), 'approved', 'a security admin or above approves'));
select t(is((select public.decide_runtime_approval(current_setting('t20.appr')::uuid, 'approve', 'again')), 'approved', 'a decided approval is terminal: a second call changes nothing'));
select t(is((select count(*)::int from public.runtime_approval_decisions), 1, 'the decision is recorded'));
set local role postgres;
select t(throws_ok($$ update public.runtime_approval_decisions set decision = 'reject' $$, '23514', null, 'decisions are append-only'));
select t(is((select count(*)::int from public.capability_tokens where task_id = '20000000-0000-4000-8000-000000000020' and tool = 'github.create_branch'), 0, 'approval alone minted no capability'));

-- the task's own principal / agent owner cannot self-approve
select public.t20_auth('p-2', 'github.create_branch', '{"branch":"authority/x/z"}'::jsonb, '20000000-0000-4000-8000-000000000021', 'acme-t20/widgets', 1, 'medium');
select set_config('t20.appr2', (select id::text from public.runtime_approval_requests where task_id = '20000000-0000-4000-8000-000000000021'), true);
update public.tasks set principal_id = '20000000-0000-4000-8000-000000000002' where id = '20000000-0000-4000-8000-000000000021';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}'; -- owner.a = the task's principal now
select t(throws_ok($$ select public.decide_runtime_approval(current_setting('t20.appr2')::uuid, 'approve', 'x') $$, '42501', null, 'the task''s own principal cannot approve it'));
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}'; -- admin.a
select t(is((select public.decide_runtime_approval(current_setting('t20.appr2')::uuid, 'reject', 'no')), 'rejected', 'a different approver can reject'));
set local role postgres;
select t(is((select status from public.runtime_approval_requests where id = current_setting('t20.appr2')::uuid), 'rejected', 'a rejected approval is terminal'));

-- policy change makes a pending approval stale
select public.t20_auth('p-3', 'github.delete_branch', '{"branch":"authority/x/old"}'::jsonb, '20000000-0000-4000-8000-000000000022', null, 1, 'high');
select t(is((select required_approvals from public.runtime_approval_requests where task_id = '20000000-0000-4000-8000-000000000022'), 2, 'a high-risk request needs two approvals'));
select set_config('t20.appr3', (select id::text from public.runtime_approval_requests where task_id = '20000000-0000-4000-8000-000000000022'), true);
update public.semantic_settings set runtime_approval_classes = '{high}' where tenant_id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(is((select public.decide_runtime_approval(current_setting('t20.appr3')::uuid, 'approve', 'x')), 'stale', 'changing policy makes a pending approval stale at decision time'));
set local role postgres;
select t(is((select stale_reason from public.runtime_approval_requests where id = current_setting('t20.appr3')::uuid), 'CONTEXT_CHANGED', 'with a recorded reason'));

-- disconnect / webhook deletion revokes capabilities and returns budget
select public.t20_auth('e-1', 'github.get_issue', '{}'::jsonb, '20000000-0000-4000-8000-000000000020', 'acme-t20/widgets', 2);
select t(is((select d_status from gateway.github_disconnect('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, '20000000-0000-4000-8000-0000000000d1'::uuid)), 'forbidden', 'a developer cannot disconnect an installation'));
select set_config('t20.revoked', (select d_revoked::text from gateway.github_disconnect('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-0000000000d1'::uuid)), true);
select t(ok(current_setting('t20.revoked')::int >= 1, 'an owner disconnects it, revoking live GitHub capabilities'));
select t(is((select status from public.github_installations where id = '20000000-0000-4000-8000-0000000000d1'), 'disconnected', 'disconnect marks the installation disconnected'));
select t(is((select count(*)::int from public.github_repositories where installation_row_id = '20000000-0000-4000-8000-0000000000d1' and allowed), 0, 'and clears every allowlist entry'));
select t(is((select reason from public.t20_reserve('rz-1', 'e-1')), 'CAPABILITY_REVOKED', 'a capability revoked by disconnect cannot be reserved'));

-- =====================================================================
-- 6. A signed-in member without a principal row gets one on first use; a non-member never does.
-- =====================================================================
select set_config('t20.viewer_principal', gateway.actor_principal('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000004'::uuid)::text, true);
select t(ok(current_setting('t20.viewer_principal') <> '', 'a member with no principal gets one created on first use'));
select t(is(gateway.actor_principal('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000004'::uuid)::text, current_setting('t20.viewer_principal'), 'and the same one on every later call'));
select t(is(gateway.actor_principal('11111111-1111-4111-8111-111111111111'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid), null, 'a user who is not a member of the tenant gets none'));
select t(is(gateway.actor_principal('22222222-2222-4222-8222-222222222222'::uuid, 'a0000000-0000-4000-8000-000000000004'::uuid), null, 'membership in one tenant confers nothing in another'));
