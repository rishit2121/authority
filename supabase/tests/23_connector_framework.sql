-- Generic connector framework: connection lifecycle, RLS, and the two-phase
-- reserve -> dispatch -> settle -> reconcile state machine for non-GitHub
-- connectors, against the real deployed schema. Mirrors
-- 20_github_connector.sql's structure for the parts that generalize.

select plan(34);

set local role postgres;

select set_config('authority.allow_demo_purge', 'on', true);
delete from public.connector_execution_receipts where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.task_connector_bindings where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.connector_reservations where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.connector_connections where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
select set_config('authority.allow_demo_purge', 'off', true);

insert into public.principals (id, tenant_id, kind, display_name, user_id) values
  ('23000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'human', 'Task Owner (dev.a)', 'a0000000-0000-4000-8000-000000000003'),
  ('23000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'human', 'Owner B', 'b0000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;
insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status) values
  ('23000000-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111', 'agent-23', 'openai', 'gpt', 'x', '23000000-0000-4000-8000-000000000001', 'active')
on conflict (id) do nothing;
insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status) values
  ('23000000-0000-4000-8000-000000000020', '11111111-1111-4111-8111-111111111111', '23000000-0000-4000-8000-000000000010', '23000000-0000-4000-8000-000000000001', 'Connector framework task', 'contract_issued')
on conflict (id) do nothing;

create or replace function public.t23_activate(p_task uuid, p_id uuid, p_max int) returns void
language sql security definer set search_path = '' as $$
  insert into public.task_authority_contracts (
    id, tenant_id, task_id, version, spec_version, allowed_actions, forbidden_resources, forbidden_operations,
    ephemeral_limits, contract_status, registry_version, compiler_version, input_hash, output_hash,
    data_flow_bindings, required_approvals, activated_at, expires_at, required_approvals_spec, demo_key)
  values (p_id, '11111111-1111-4111-8111-111111111111', p_task, 1, 'v1',
    '{"schemaVersion":1,"items":[{"tool":"widgetco.retrieve_widget","constraints":[]},{"tool":"bindtest.do_thing","constraints":[]}]}'::jsonb,
    '{}', '{}', jsonb_build_object('schemaVersion', 1, 'maxToolInvocations', p_max, 'expiresInSeconds', 3600),
    'active', 'rv1', 'cv1', repeat('9', 64), repeat('8', 64), '{"schemaVersion":1,"refs":[]}'::jsonb,
    '{"schemaVersion":1,"items":[]}'::jsonb, now(), now() + interval '1 hour', '{"schemaVersion":1,"items":[]}'::jsonb, 't23:' || p_id::text)
  on conflict (id) do nothing
$$;
select public.t23_activate('23000000-0000-4000-8000-000000000020', '23000000-0000-4000-8000-0000000000c1', 40);

create or replace function public.t23_auth(p_key text, p_args jsonb default '{}'::jsonb, p_uses int default 1) returns table (status text, cap uuid)
language sql security definer set search_path = '' as $$
  select c.r_status, c.r_capability_id
  from gateway.commit_authorization(current_setting('test.secret_23a'), '23000000-0000-4000-8000-000000000020'::uuid,
    'widgetco.retrieve_widget', 'op', 'widget-1', p_args,
    '{"schemaVersion":1,"count":0,"truncated":false,"entries":[]}'::jsonb, null, p_key, 'rv1', 'cv1', 'low', p_uses,
    encode(extensions.digest('authcap_v1_' || p_key, 'sha256'), 'hex'), null, null, null, null, null, null, null, null, null, null, null, null,
    't23', false) c
$$;
create or replace function public.t23_reserve(p_key text, p_token_key text, p_mode text default 'mock')
returns table (result text, reason text, exec uuid, connector text, connection uuid, prev text)
language sql security definer set search_path = '' as $$
  select r.rce_result, r.rce_reason_code, r.rce_execution_id, r.rce_connector_id, r.rce_connection_id, r.rce_prev_category
  from gateway.reserve_connector_execution(current_setting('test.secret_23a'),
    encode(extensions.digest('authcap_v1_' || p_token_key, 'sha256'), 'hex'), 'widgetco.retrieve_widget', 'op', 'widget-1', '{}'::jsonb, p_key, p_mode, 45) r
$$;
create or replace function public.t23_tok(p_key text) returns text language sql stable set search_path = '' as $$
  select encode(extensions.digest('authcap_v1_' || p_key, 'sha256'), 'hex') $$;

create or replace function public.t23_auth_bind(p_key text) returns table (status text, cap uuid)
language sql security definer set search_path = '' as $$
  select c.r_status, c.r_capability_id
  from gateway.commit_authorization(current_setting('test.secret_23a'), '23000000-0000-4000-8000-000000000020'::uuid,
    'bindtest.do_thing', 'op', 'thing-1', '{}'::jsonb,
    '{"schemaVersion":1,"count":0,"truncated":false,"entries":[]}'::jsonb, null, p_key, 'rv1', 'cv1', 'low', 1,
    encode(extensions.digest('authcap_v1_' || p_key, 'sha256'), 'hex'), null, null, null, null, null, null, null, null, null, null, null, null,
    't23', false) c
$$;
create or replace function public.t23_reserve_bind(p_key text, p_token_key text)
returns table (result text, reason text, exec uuid, connector text, connection uuid, prev text)
language sql security definer set search_path = '' as $$
  select r.rce_result, r.rce_reason_code, r.rce_execution_id, r.rce_connector_id, r.rce_connection_id, r.rce_prev_category
  from gateway.reserve_connector_execution(current_setting('test.secret_23a'),
    encode(extensions.digest('authcap_v1_' || p_token_key, 'sha256'), 'hex'), 'bindtest.do_thing', 'op', 'thing-1', '{}'::jsonb, p_key, 'mock', 45) r
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select set_config('test.secret_23a', r.plaintext_secret, true) from public.create_agent_credential('23000000-0000-4000-8000-000000000010'::uuid) r;
set local role postgres;

-- =====================================================================
-- 1. Connection lifecycle RPCs and RLS.
-- =====================================================================
select t(is((select cc_status from gateway.create_connector_connection(
  '11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, 'throwaway', 'A throwaway connection', 'development')),
  'ok', 'an admin can create a connector connection'));
select set_config('t23.conn', '23000000-0000-4000-8000-00000000ffff', true);
select t(is((select cc_status from gateway.create_connector_connection(
  '11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, 'throwaway', 'dup', 'development')),
  'already_connected', 'only one non-disconnected connection per connector per tenant'));
select t(is((select cc_status from gateway.create_connector_connection(
  '11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000004'::uuid, 'other', 'x', 'development')),
  'forbidden', 'a viewer cannot create a connection'));

select t(ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('connector_connections', 'connector_reservations', 'connector_execution_receipts')),
  'row level security is enabled on every new table'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(is((select count(*)::int from public.connector_connections where connector_id = 'throwaway'), 1, 'a tenant member sees its own connection'));
select t(throws_ok($$ insert into public.connector_connections (tenant_id, connector_id, name) values ('11111111-1111-4111-8111-111111111111', 'evil', 'x') $$,
  '42501', null, 'a client cannot create a connection directly'));
select t(throws_ok($$ update public.connector_connections set status = 'disconnected' $$, '42501', null, 'a client cannot disconnect directly'));
select t(throws_ok($$ select gateway.reserve_connector_execution('x', repeat('a', 64), 'widgetco.retrieve_widget', 'op', null, '{}'::jsonb, 'k', 'mock', 45) $$,
  '42501', null, 'a signed-in user cannot reach gateway.reserve_connector_execution'));
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(is((select count(*)::int from public.connector_connections where connector_id = 'throwaway'), 0, 'tenant B sees none of tenant A''s connections'));
set local role postgres;

-- =====================================================================
-- 2. Reserve -> dispatch -> settle, generic path.
-- =====================================================================
select t(is((select status from public.t23_auth('a-1')), 'ok', 'a capability is issued for a tool with no GitHub-specific concept at all'));
select t(is((select reason from public.t23_reserve('r-1', 'a-1')), 'CONNECTOR_NOT_CONFIGURED', 'no active connection yet -> refused, not silently allowed'));

select gateway.create_connector_connection('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, 'widgetco', 'Our Widget Co account', 'development');

select t(is((select result from public.t23_reserve('r-2', 'a-1')), 'reserved', 'reservation succeeds once a connection exists'));
select set_config('t23.exec1', (select exec::text from public.t23_reserve('r-2', 'a-1')), true);
select t(is((select result from public.t23_reserve('r-2', 'a-1')), 'in_progress', 'the same key while in flight reports in_progress'));
select t(is((select mcd_status from gateway.mark_connector_dispatched(current_setting('t23.exec1')::uuid, '23000000-0000-4000-8000-000000000010'::uuid)), 'ok', 'dispatch succeeds once'));
select t(is((select mcd_status from gateway.mark_connector_dispatched(current_setting('t23.exec1')::uuid, '23000000-0000-4000-8000-000000000010'::uuid)), 'already_dispatched', 'and never twice'));
select t(is((select fce_status from gateway.finish_connector_execution(current_setting('t23.exec1')::uuid, '23000000-0000-4000-8000-000000000010'::uuid,
  'succeeded', null, 'WIDGETCO-1', 2::smallint, '{"schemaVersion":1}'::jsonb, now(), '{"schemaVersion":1}'::jsonb)), 'ok', 'the reserving execution settles it'));
select t(is((select uses || '/' || reserved_uses || '/' || status from public.capability_tokens where token_hash = public.t23_tok('a-1')), '1/0/consumed', 'consumed only after settlement'));
select t(is((select count(*)::int from public.connector_execution_receipts where execution_id = current_setting('t23.exec1')::uuid and result_category = 'succeeded'), 1, 'exactly one receipt was written'));
select t(is((select result || ':' || prev from public.t23_reserve('r-2', 'a-1')), 'replayed:consumed', 'the same key replays the recorded outcome'));

-- release refunds before dispatch; indeterminate after
select public.t23_auth('a-2');
select set_config('t23.exec2', (select exec::text from public.t23_reserve('r-3', 'a-2')), true);
select gateway.settle_connector_reservation(current_setting('t23.exec2')::uuid, 'released', 'ARGUMENTS_INVALID', null, null, null, null, null);
select t(is((select uses || '/' || reserved_uses from public.capability_tokens where token_hash = public.t23_tok('a-2')), '0/0', 'a release before dispatch refunds the use'));

select public.t23_auth('a-3');
select set_config('t23.exec3', (select exec::text from public.t23_reserve('r-4', 'a-3')), true);
select gateway.mark_connector_dispatched(current_setting('t23.exec3')::uuid, '23000000-0000-4000-8000-000000000010'::uuid);
select gateway.finish_connector_execution(current_setting('t23.exec3')::uuid, '23000000-0000-4000-8000-000000000010'::uuid, 'indeterminate', 'TRANSPORT_TIMEOUT', null, null,
  '{"schemaVersion":1}'::jsonb, now(), '{"schemaVersion":1}'::jsonb);
select t(is((select uses || '/' || status from public.capability_tokens where token_hash = public.t23_tok('a-3')), '1/consumed', 'an indeterminate write still spends the use'));
select t(is((select status from public.connector_reservations where id = current_setting('t23.exec3')::uuid), 'indeterminate', 'and is recorded as indeterminate, never silently retried'));

-- lease expiry / reconciliation
select public.t23_auth('a-4');
select set_config('t23.exec4', (select exec::text from public.t23_reserve('r-5', 'a-4')), true);
alter table public.connector_reservations disable trigger connector_reservations_guard;
update public.connector_reservations set reserved_at = now() - interval '3 minutes', lease_expires_at = now() - interval '2 minutes'
  where id = current_setting('t23.exec4')::uuid;
alter table public.connector_reservations enable trigger connector_reservations_guard;
select gateway.reconcile_expired_connector_reservations(50);
select t(is((select status || ':' || reason_code from public.connector_reservations where id = current_setting('t23.exec4')::uuid),
  'released:LEASE_EXPIRED_BEFORE_DISPATCH', 'an expired undispatched lease is released, not stuck forever'));

-- =====================================================================
-- 3. Disconnect revokes every capability for that connector's tools and
--    blocks new reservations, without touching evidence already written.
-- =====================================================================
select public.t23_auth('a-5');
select t(is((select dc_status from gateway.disconnect_connector_connection(
  '11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, current_setting('t23.conn')::uuid)),
  'not_found', 'disconnecting a never-fully-created connection reports not_found'));
select t(is((select dc_revoked_capabilities from gateway.disconnect_connector_connection(
  '11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid,
  (select id from public.connector_connections where tenant_id = '11111111-1111-4111-8111-111111111111' and connector_id = 'widgetco'))),
  3, 'disconnecting revokes every still-active widgetco capability, including ones already reserved-then-released'));
select t(is((select status from public.capability_tokens where token_hash = public.t23_tok('a-5')), 'revoked', 'and it is actually revoked'));
select t(is((select reason from public.t23_reserve('r-6', 'a-5')), 'CAPABILITY_REVOKED', 'a revoked capability can never be reserved again'));
select public.t23_auth('a-6');
-- This task was already first-use-pinned to the widgetco connection by the
-- reservations earlier in this suite (task_connector_bindings). Embedded
-- customer connections (20261003000004_task_customer_binding.sql) rewrote
-- reserve_connector_execution's connection resolution so a pre-bound task
-- re-verifies its OWN pinned connection first, before ever asking "is
-- anything configured for this provider at all" -- needed once a tenant can
-- hold several simultaneous connections per provider, so a bound task can
-- never silently drift onto a different one. A pinned connection that is now
-- disconnected is therefore reported as CONNECTOR_CONNECTION_CHANGED, not the
-- old CONNECTOR_NOT_CONFIGURED -- strictly more specific (something WAS
-- configured for this task; it specifically went away), and the reservation
-- is rejected either way, so no capability ever resolves to a disconnected
-- connection under either reason code.
select t(is((select reason from public.t23_reserve('r-7', 'a-6')), 'CONNECTOR_CONNECTION_CHANGED', 'and no new reservation can be made once disconnected'));
select t(is((select count(*)::int from public.connector_execution_receipts where tenant_id = '11111111-1111-4111-8111-111111111111'), 4,
  'every receipt written before disconnect is preserved'));

-- =====================================================================
-- 4. Task <-> connector binding: a disconnect-and-reconnect mid-task can
--    never silently swap which connection a task's tool calls run against.
-- =====================================================================
select gateway.create_connector_connection('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, 'bindtest', 'First bindtest connection', 'development');
select public.t23_auth_bind('bind-1');
select t(is((select result from public.t23_reserve_bind('rbind-1', 'bind-1')), 'reserved', 'first reservation for this task+connector pins the binding'));
select t(is((select connection_id from public.task_connector_bindings
  where task_id = '23000000-0000-4000-8000-000000000020' and connector_id = 'bindtest'),
  (select id from public.connector_connections where tenant_id = '11111111-1111-4111-8111-111111111111' and connector_id = 'bindtest'),
  'the binding points at the connection that was active at first use'));

-- Disconnect and reconnect with a brand new connection under the same connector_id.
select gateway.disconnect_connector_connection('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid,
  (select id from public.connector_connections where tenant_id = '11111111-1111-4111-8111-111111111111' and connector_id = 'bindtest'));
select gateway.create_connector_connection('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, 'bindtest', 'Second bindtest connection (different credentials)', 'development');

select public.t23_auth_bind('bind-2');
select t(is((select reason from public.t23_reserve_bind('rbind-2', 'bind-2')), 'CONNECTOR_CONNECTION_CHANGED',
  'a reconnect under the same connector_id can never silently take over an already-bound task'));
select t(is((select uses from public.capability_tokens where token_hash = public.t23_tok('bind-2')), 0,
  'the rejected reservation never spent the capability''s use'));
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(throws_ok($$ delete from public.task_connector_bindings $$, '42501', null, 'a client cannot delete a task-connector binding directly'));
set local role postgres;

select * from finish();
