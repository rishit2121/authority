-- Regression for a real, exploitable bug found during security review and
-- fixed in 20260924000006_fix_schema_version_null_bypass.sql:
-- authz.has_allowed_schema_version() returned SQL NULL, not false, for a
-- JSONB payload with no `schemaVersion` key at all. A table CHECK
-- constraint treats a NULL result as satisfied — the opposite of RLS's
-- USING/WITH CHECK convention, where NULL means deny — so a payload missing
-- the key entirely bypassed the version gate, even though a payload with a
-- *present but unrecognized* version was always correctly rejected. Same bug
-- class as the role_rank NULL-bypass in 08/09: a boolean-returning helper
-- silently passing in the one calling context that doesn't treat NULL as a
-- rejection.
--
-- `policies.conditions` is used here because it is one of only two JSONB
-- columns actually reachable by a direct client INSERT/UPDATE (the other is
-- `integrations.configured_scopes_metadata`, covered below) — every other
-- JSONB column this same check guards is on a table with no client write
-- grant at all, so it can only ever be written by a SECURITY DEFINER RPC
-- that always supplies a valid, hardcoded schemaVersion.

select plan(6);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
-- owner.a: security_admin-and-above satisfied, real member of tenant A.

-- The regression: a payload missing the schemaVersion key entirely.
select t(throws_like(
  $$ insert into public.policies (tenant_id, name, effect, conditions)
     values ('11111111-1111-4111-8111-111111111111', 'AUDIT missing version', 'deny', '{}'::jsonb) $$,
  '%violates check constraint%',
  'a policies.conditions payload with no schemaVersion key is rejected, not silently accepted'));

-- The already-correctly-handled case: present but unrecognized version.
select t(throws_like(
  $$ insert into public.policies (tenant_id, name, effect, conditions)
     values ('11111111-1111-4111-8111-111111111111', 'AUDIT wrong version', 'deny',
             '{"schemaVersion":99,"rules":[]}'::jsonb) $$,
  '%violates check constraint%',
  'a policies.conditions payload with an unrecognized (but present) schemaVersion is rejected'));

-- Positive control: a well-formed payload is still accepted.
select t(lives_ok(
  $$ insert into public.policies (tenant_id, name, effect, conditions)
     values ('11111111-1111-4111-8111-111111111111', 'AUDIT valid version', 'deny',
             '{"schemaVersion":1,"rules":[]}'::jsonb) $$,
  'a well-formed policies.conditions payload is still accepted'));

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
-- admin.a: admin-and-above satisfied for integrations, real member of tenant A.

select t(throws_like(
  $$ insert into public.integrations (tenant_id, provider, display_name, configured_scopes_metadata)
     values ('11111111-1111-4111-8111-111111111111', 'salesforce', 'AUDIT Salesforce', '{}'::jsonb) $$,
  '%violates check constraint%',
  'an integrations.configured_scopes_metadata payload with no schemaVersion key is rejected'));

select t(throws_like(
  $$ insert into public.integrations (tenant_id, provider, display_name, configured_scopes_metadata)
     values ('11111111-1111-4111-8111-111111111111', 'salesforce', 'AUDIT Salesforce', '{"schemaVersion":99,"scopes":[]}'::jsonb) $$,
  '%violates check constraint%',
  'an integrations.configured_scopes_metadata payload with an unrecognized version is rejected'));

select t(lives_ok(
  $$ insert into public.integrations (tenant_id, provider, display_name, configured_scopes_metadata)
     values ('11111111-1111-4111-8111-111111111111', 'salesforce', 'AUDIT Salesforce', '{"schemaVersion":1,"scopes":[]}'::jsonb) $$,
  'a well-formed integrations.configured_scopes_metadata payload is still accepted'));
