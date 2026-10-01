-- Connector credential storage via Supabase Vault: admin-gated set/rotate,
-- metadata-only client visibility, server-only plaintext resolution.

select plan(15);

set local role postgres;

select set_config('authority.allow_demo_purge', 'on', true);
delete from public.connector_connection_secrets where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.connector_connections where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222') and connector_id = 'secrettest';
select set_config('authority.allow_demo_purge', 'off', true);

select gateway.create_connector_connection('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, 'secrettest', 'Secret test connection', 'development');

-- =====================================================================
-- 1. Setting a secret: admin+ only, never visible in plaintext to any client.
-- =====================================================================
select t(is(gateway.set_connector_secret('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid,
  (select id from public.connector_connections where connector_id = 'secrettest'), 'bearer_token', 'sk_test_abc123'),
  'forbidden', 'a developer cannot set a connector secret'));
select t(is(gateway.set_connector_secret('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000002'::uuid,
  (select id from public.connector_connections where connector_id = 'secrettest'), 'bearer_token', 'sk_test_abc123'),
  'ok', 'an admin can set a connector secret'));
select t(is(gateway.has_connector_secret((select id from public.connector_connections where connector_id = 'secrettest'), 'bearer_token'), true,
  'the secret is recorded as configured'));
select t(ok((select relrowsecurity from pg_class where relname = 'connector_connection_secrets'), 'row level security is enabled'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(is((select secret_type from public.connector_connection_secrets where connection_id = (select id from public.connector_connections where connector_id = 'secrettest')),
  'bearer_token', 'a tenant member sees the secret''s metadata (type, dates)'));
select t(throws_ok($$ select vault_secret_id from public.connector_connection_secrets $$, '42501', null,
  'the vault secret id is not even in the column grant -- not selectable at any role'));
select t(throws_ok($$ select gateway.resolve_connector_secret((select id from public.connector_connections where connector_id = 'secrettest'), 'bearer_token') $$,
  '42501', null, 'a signed-in user cannot resolve plaintext -- server-only'));
select t(throws_ok($$ insert into public.connector_connection_secrets (tenant_id, connection_id, secret_type, vault_secret_id)
  values ('11111111-1111-4111-8111-111111111111', (select id from public.connector_connections limit 1), 'api_key', gen_random_uuid()) $$,
  '42501', null, 'a client cannot insert a secret reference directly'));
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(is((select count(*)::int from public.connector_connection_secrets
  where connection_id = (select id from public.connector_connections where connector_id = 'secrettest')), 0,
  'tenant B sees none of tenant A''s connector secret metadata'));
set local role postgres;

-- =====================================================================
-- 2. Resolution (server-only) returns the real plaintext, and nothing else does.
-- =====================================================================
select t(is(gateway.resolve_connector_secret((select id from public.connector_connections where connector_id = 'secrettest'), 'bearer_token'),
  'sk_test_abc123', 'the gateway-only resolver returns the real plaintext'));
select t(is(gateway.resolve_connector_secret((select id from public.connector_connections where connector_id = 'secrettest'), 'api_key'),
  null, 'resolving an unconfigured secret type returns null, not an error'));

-- =====================================================================
-- 3. Rotation replaces the plaintext in place; the reference row is reused,
--    not duplicated, and bumps the connection's config version.
-- =====================================================================
select set_config('t25.version_before', (select config_version::text from public.connector_connections where connector_id = 'secrettest'), true);
select t(is(gateway.set_connector_secret('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000002'::uuid,
  (select id from public.connector_connections where connector_id = 'secrettest'), 'bearer_token', 'sk_test_rotated'),
  'ok', 'an admin rotates the secret'));
select t(is(gateway.resolve_connector_secret((select id from public.connector_connections where connector_id = 'secrettest'), 'bearer_token'),
  'sk_test_rotated', 'the rotated value is what resolves now, not the original'));
select t(is((select count(*)::int from public.connector_connection_secrets
  where connection_id = (select id from public.connector_connections where connector_id = 'secrettest') and secret_type = 'bearer_token'), 1,
  'rotation reuses one reference row rather than accumulating a new one'));
select t(cmp_ok((select config_version from public.connector_connections where connector_id = 'secrettest'), '>',
  current_setting('t25.version_before')::int, 'rotating a secret is a configuration change -- the version moves forward'));

select * from finish();
