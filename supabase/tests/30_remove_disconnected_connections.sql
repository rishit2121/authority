-- Removing (archiving) a disconnected connection (20261028000002): admins only, disconnected only, history kept.

select plan(7);

insert into public.connector_connections (id, tenant_id, connector_id, name, status, disconnected_at) values
  ('30000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'custom_t30a', 'old', 'disconnected', now()),
  ('30000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'custom_t30b', 'live', 'active', null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(is(public.remove_connector_connection('30000000-0000-4000-8000-000000000001'), 'forbidden', 'a developer cannot remove a connection'));
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(is(public.remove_connector_connection('30000000-0000-4000-8000-000000000001'), 'not_found', 'another tenant cannot see it'));
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select t(is(public.remove_connector_connection('30000000-0000-4000-8000-000000000002'), 'not_disconnected', 'an active connection must be disconnected first'));
select t(is(public.remove_connector_connection('30000000-0000-4000-8000-000000000001'), 'ok', 'an admin removes a disconnected connection'));
select t(ok((select archived_at is not null from public.connector_connections where id = '30000000-0000-4000-8000-000000000001'),
  'it is archived, not deleted'));
set local role postgres;
select t(throws_ok($$ update public.connector_connections set archived_at = now() where id = '30000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'an active connection can never be archived'));
set local role anon;
select t(throws_ok($$ select public.remove_connector_connection('30000000-0000-4000-8000-000000000001') $$, '42501', null,
  'anonymous callers cannot remove connections'));

select * from finish();
