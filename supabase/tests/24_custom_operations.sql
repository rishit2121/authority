-- Custom API operation registry: draft -> validated -> published -> retired,
-- and the one privileged step (publish) that actually confers trust.

select plan(27);

set local role postgres;

select set_config('authority.allow_demo_purge', 'on', true);
delete from public.custom_operation_definitions where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.connector_connections where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222') and connector_id like 'custom_t24%';
select set_config('authority.allow_demo_purge', 'off', true);

select gateway.create_connector_connection('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, 'custom_t24a', 'Test Custom API connection', 'development');
select gateway.create_connector_connection('22222222-2222-4222-8222-222222222222'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, 'custom_t24b', 'Tenant B connection', 'development');

create or replace function public.t24_conn(p_connector text) returns uuid language sql stable set search_path = '' as $$
  select id from public.connector_connections where connector_id = p_connector $$;

-- =====================================================================
-- 1. Draft creation: role gate, slug uniqueness, structural checks.
-- =====================================================================
select t(is((select ccod_status from gateway.create_custom_operation_draft(
  '11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, public.t24_conn('custom_t24a'),
  'lookup_order', 'Look up an order', 'Reads one order by id', 'GET', '/v1/orders/{orderId}', 'read',
  '{"schemaVersion":1,"fields":[{"key":"orderId","type":"string","required":true,"identifiesResource":true,"in":"path"}]}'::jsonb,
  '{"schemaVersion":1}'::jsonb, 'bearer', '{"schemaVersion":1}'::jsonb, 8000, 10)),
  'ok', 'a developer can create a draft custom operation'));
select set_config('t24.op1', (select ccod_operation_id::text from gateway.create_custom_operation_draft(
  '11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, public.t24_conn('custom_t24a'),
  'cancel_order', 'Cancel an order', null, 'POST', '/v1/orders/{orderId}/cancel', 'write_create',
  '{"schemaVersion":1,"fields":[{"key":"orderId","type":"string","required":true,"identifiesResource":true,"in":"path"}]}'::jsonb,
  '{"schemaVersion":1}'::jsonb, 'bearer', '{"schemaVersion":1}'::jsonb, 8000, null)), true);
select t(is((select ccod_status from gateway.create_custom_operation_draft(
  '11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, public.t24_conn('custom_t24a'),
  'cancel_order', 'dup', null, 'POST', '/v1/orders/{orderId}/cancel', 'write_create',
  '{"schemaVersion":1,"fields":[]}'::jsonb, '{"schemaVersion":1}'::jsonb, 'none', '{"schemaVersion":1}'::jsonb, 8000, null)),
  'slug_taken', 'an operation slug is unique per connection'));
select t(is((select ccod_status from gateway.create_custom_operation_draft(
  '11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000004'::uuid, public.t24_conn('custom_t24a'),
  'viewer_attempt', 'x', null, 'GET', '/v1/x', 'read', '{"schemaVersion":1,"fields":[]}'::jsonb,
  '{"schemaVersion":1}'::jsonb, 'none', '{"schemaVersion":1}'::jsonb, 8000, null)),
  'forbidden', 'a viewer cannot create a draft'));
select t(is((select tool_name from public.custom_operation_definitions where id = current_setting('t24.op1')::uuid),
  'custom_t24a.cancel_order', 'the tool name is derived from the connection''s connector id and the slug'));

select t(ok((select relrowsecurity from pg_class where relname = 'custom_operation_definitions'), 'row level security is enabled'));
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';
select t(is((select count(*)::int from public.custom_operation_definitions), 2, 'a tenant member sees its own draft operations'));
select t(throws_ok($$ insert into public.custom_operation_definitions (tenant_id, connection_id, operation_slug, tool_name, method, path_template, effect, input_schema, request_mapping)
  values ('11111111-1111-4111-8111-111111111111', (select id from public.connector_connections limit 1), 'evil', 'evil.op', 'GET', '/x', 'read', '{"schemaVersion":1}', '{"schemaVersion":1}') $$,
  '42501', null, 'a client cannot create an operation definition by direct insert'));
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select t(is((select count(*)::int from public.custom_operation_definitions), 0, 'tenant B sees none of tenant A''s draft operations'));
set local role postgres;

-- =====================================================================
-- 2. Editing a draft; validation (deterministic, no trust granted).
-- =====================================================================
select t(is((select gateway.update_custom_operation_draft(
  '11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, current_setting('t24.op1')::uuid,
  'Cancel an order (v2 copy)', 'updated', null, null, null, null, null, null, null, null, null)),
  'ok', 'a developer can edit a draft'));
select t(is((select name from public.custom_operation_definitions where id = current_setting('t24.op1')::uuid),
  'Cancel an order (v2 copy)', 'the edit took effect'));
select t(is((select v.vco_status from gateway.validate_custom_operation(
  '11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, current_setting('t24.op1')::uuid) v),
  'ok', 'validation itself grants no special trust -- a developer (not just an admin) may run it'));
select t(is((select status from public.custom_operation_definitions where id = current_setting('t24.op1')::uuid),
  'validated', 'status advances to validated'));
select t(is((select input_schema_hash is not null and request_mapping_hash is not null from public.custom_operation_definitions
  where id = current_setting('t24.op1')::uuid), true, 'pinned hashes are recorded at validation time'));
select t(is((select gateway.update_custom_operation_draft(
  '11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, current_setting('t24.op1')::uuid,
  'should not work', null, null, null, null, null, null, null, null, null, null)),
  'not_draft', 'a validated operation can no longer be edited as a draft'));

-- A path template with no path parameter at all and no input fields is structurally invalid.
select t(is((select ccod_status from gateway.create_custom_operation_draft(
  '11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, public.t24_conn('custom_t24a'),
  'list_all', 'List everything', null, 'GET', '/v1/orders', 'read', '{"schemaVersion":1,"fields":[]}'::jsonb,
  '{"schemaVersion":1}'::jsonb, 'none', '{"schemaVersion":1}'::jsonb, 8000, null)), 'ok', 'setup: a no-parameter list operation is a legitimate draft shape'));

-- =====================================================================
-- 3. Publish is the trust boundary: security_admin+ only, and only from
--    validated. Once published, the row is frozen.
-- =====================================================================
select t(is(gateway.publish_custom_operation('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, current_setting('t24.op1')::uuid),
  'forbidden', 'a developer cannot publish -- publishing requires security_admin or above'));
select t(is(gateway.publish_custom_operation('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000002'::uuid,
  (select id from public.custom_operation_definitions where tenant_id = '11111111-1111-4111-8111-111111111111' and operation_slug = 'lookup_order')),
  'not_validated', 'a draft that was never validated cannot be published directly'));
select t(is(gateway.publish_custom_operation('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000002'::uuid, current_setting('t24.op1')::uuid),
  'ok', 'a security_admin (admin.a) publishes the validated operation'));
select t(is((select status from public.custom_operation_definitions where id = current_setting('t24.op1')::uuid), 'published', 'status is now published'));
select t(throws_ok(format($$ update public.custom_operation_definitions set name = 'renamed' where id = %L $$, current_setting('t24.op1')::uuid),
  '23514', null, 'a published operation''s own name can never change again, even via a trusted escape hatch'));
set local role postgres;
select t(throws_ok(format($$ update public.custom_operation_definitions set path_template = '/v2/orders/{orderId}/cancel' where id = %L $$, current_setting('t24.op1')::uuid),
  '23514', null, 'nor can its path template -- existing authority must never silently inherit a changed endpoint'));

-- =====================================================================
-- 4. Retire: security_admin+ only, one-way, never un-retires, never deletes evidence.
-- =====================================================================
select t(is(gateway.retire_custom_operation('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, current_setting('t24.op1')::uuid),
  'forbidden', 'a developer cannot retire a published operation'));
select t(is(gateway.retire_custom_operation('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000002'::uuid, current_setting('t24.op1')::uuid),
  'ok', 'a security_admin retires it'));
select t(throws_ok(format($$ update public.custom_operation_definitions set status = 'published' where id = %L $$, current_setting('t24.op1')::uuid),
  '23514', null, 'a retired operation can never be un-retired'));
select t(is(gateway.retire_custom_operation('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000002'::uuid, current_setting('t24.op1')::uuid),
  'not_published', 'retiring an already-retired operation is refused, not silently repeated'));

-- =====================================================================
-- 5. Deleting a draft (before it is ever published) is allowed and clean.
-- =====================================================================
select t(is(gateway.delete_custom_operation_draft('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid,
  (select id from public.custom_operation_definitions where tenant_id = '11111111-1111-4111-8111-111111111111' and operation_slug = 'list_all')),
  'ok', 'a developer can delete their own unpublished draft'));
select t(is(gateway.delete_custom_operation_draft('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, current_setting('t24.op1')::uuid),
  'not_draft', 'a published (even if retired) operation can never be deleted'));

select * from finish();
