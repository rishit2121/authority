-- Part 8: Validation Lab and launch hardening, against the real deployed schema.
-- Sandbox isolation, actor-verified gateway functions, tenant RLS, client write lockout, immutable scenario versions and
-- steps, remediations that can never claim to broaden authority, role-gated decisions, retention, webhook retries and
-- the schema-version probe.

select plan(62);

set local role postgres;

-- Independent of any Validation Lab state left in the shared dev project (rolled back with the suite).
select set_config('authority.allow_demo_purge', 'on', true);
delete from public.validation_campaigns where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.validation_regressions where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.validation_environments where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.validation_scenario_versions where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.github_webhook_retries where delivery_id like 't21-%';
delete from public.tenant_retention_settings where tenant_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
select set_config('authority.allow_demo_purge', 'off', true);

-- =====================================================================
-- 1. Every new table is protected.
-- =====================================================================
select t(ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('validation_environments','validation_scenario_versions','validation_campaigns','validation_runs',
    'validation_steps','validation_findings','validation_remediations','validation_regressions','tenant_retention_settings','github_webhook_retries')),
  'row level security is enabled on every Part 8 table'));

-- =====================================================================
-- 2. Sandboxes: isolated, expiring, member-less, and every sandbox function refuses a real tenant.
-- =====================================================================
select set_config('t21.sandbox', gateway.vl_create_sandbox('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, 30)::text, true);
select t(is((select validation_sandbox from public.tenants where id = current_setting('t21.sandbox')::uuid), true, 'a sandbox is flagged as one'));
select t(is((select environment::text from public.tenants where id = current_setting('t21.sandbox')::uuid), 'development', 'and is always a development tenant'));
select t(ok((select validation_expires_at > now() and validation_expires_at <= now() + interval '31 minutes' from public.tenants where id = current_setting('t21.sandbox')::uuid), 'and always has a bounded expiry'));
select t(is((select count(*)::int from public.tenant_memberships where tenant_id = current_setting('t21.sandbox')::uuid), 0, 'no user is a member of a sandbox'));
select t(is((select validation_owner_tenant_id from public.tenants where id = current_setting('t21.sandbox')::uuid), '11111111-1111-4111-8111-111111111111'::uuid, 'it records the customer tenant that owns it'));
select t(lives_ok($$ select gateway.vl_assert_sandbox(current_setting('t21.sandbox')::uuid) $$, 'a live sandbox passes the guard'));
select t(throws_ok($$ select gateway.vl_assert_sandbox('11111111-1111-4111-8111-111111111111'::uuid) $$, '42501', null, 'a real tenant fails the sandbox guard'));
select t(throws_ok($$ select gateway.vl_destroy_sandbox('11111111-1111-4111-8111-111111111111'::uuid) $$, '42501', null, 'a real tenant can never be destroyed as a sandbox'));
select t(throws_ok($$ select gateway.vl_fault('11111111-1111-4111-8111-111111111111'::uuid, 'revoke_contract', '{}'::jsonb) $$, '42501', null, 'faults cannot be injected into a real tenant'));
select t(throws_ok($$ select * from gateway.vl_evidence('11111111-1111-4111-8111-111111111111'::uuid) $$, '42501', null, 'evidence cannot be read from a real tenant through the sandbox path'));
select t(throws_ok($$ select gateway.vl_seed_sandbox('11111111-1111-4111-8111-111111111111'::uuid, '{"agents":[{"key":"primary"}],"contract":{}}'::jsonb) $$, '42501', null, 'a real tenant cannot be seeded as a sandbox'));
select t(throws_ok($$ select gateway.vl_create_sandbox('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000004'::uuid, 10) $$, '42501', null, 'a viewer cannot create a sandbox'));
select t(throws_ok($$ select gateway.vl_create_sandbox('11111111-1111-4111-8111-111111111111'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, 10) $$, '42501', null, 'a member of another tenant cannot either'));
select t(throws_ok($$ select gateway.vl_create_sandbox('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, 9999) $$, '22023', null, 'a sandbox lifetime is bounded'));
select t(throws_ok($$ select gateway.vl_create_sandbox(current_setting('t21.sandbox')::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, 10) $$, '42501', null, 'a sandbox cannot own a sandbox'));
update public.tenants set validation_expires_at = now() - interval '1 minute' where id = current_setting('t21.sandbox')::uuid;
select t(throws_ok($$ select gateway.vl_assert_sandbox(current_setting('t21.sandbox')::uuid) $$, '42501', null, 'an expired sandbox is unusable'));
select t(ok((select sw_sandboxes >= 1 from gateway.vl_sweep(50)), 'the sweep destroys expired sandboxes'));
select t(is((select count(*)::int from public.tenants where id = current_setting('t21.sandbox')::uuid), 0, 'and they are gone'));

-- =====================================================================
-- 3. Environments and campaigns: role-gated writes through the gateway, tenant-scoped reads, no client writes.
-- =====================================================================
select set_config('t21.env', gateway.vl_create_environment('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, 'env 21', null, '{"schemaVersion":1}'::jsonb, 4)::text, true);
select t(throws_ok($$ select gateway.vl_create_environment('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000004'::uuid, 'x', null, '{"schemaVersion":1}'::jsonb, 4) $$, '42501', null, 'a viewer cannot create an environment'));
select t(throws_ok($$ select gateway.vl_create_environment('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, 'x', null, '{"schemaVersion":1}'::jsonb, 0) $$, '22023', null, 'an environment lifetime is bounded'));
select t(throws_ok($$ insert into public.validation_environments (tenant_id, name, spec, expires_at) values ('11111111-1111-4111-8111-111111111111', 'x', '{"schemaVersion":99}', now() + interval '1 day') $$, '23514', null, 'a spec with an unsupported schema version is refused'));

select set_config('t21.sv', gateway.vl_register_scenario('11111111-1111-4111-8111-111111111111'::uuid, 'scenario-21', 1, 'builtin', '{"k":1}'::jsonb, repeat('a', 64))::text, true);
select t(is(gateway.vl_register_scenario('11111111-1111-4111-8111-111111111111'::uuid, 'scenario-21', 1, 'builtin', '{"k":1}'::jsonb, repeat('a', 64))::text, current_setting('t21.sv'), 'registering the same definition again is idempotent'));
select t(throws_ok($$ select gateway.vl_register_scenario('11111111-1111-4111-8111-111111111111'::uuid, 'scenario-21', 1, 'builtin', '{"k":2}'::jsonb, repeat('b', 64)) $$, '23505', null, 'a different definition under the same version is refused'));
select t(throws_ok($$ update public.validation_scenario_versions set definition = '{"k":9}' where id = current_setting('t21.sv')::uuid $$, '23514', null, 'a scenario version is immutable'));

select set_config('t21.campaign', gateway.vl_start_campaign('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, current_setting('t21.env')::uuid, 'campaign 21', 'starter', 7, '{"scenarioKeys":["a"],"variants":["baseline"],"repetitions":1}'::jsonb, 1)::text, true);
select t(throws_ok($$ select gateway.vl_start_campaign('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000004'::uuid, current_setting('t21.env')::uuid, 'x', null, 1, '{}'::jsonb, 1) $$, '42501', null, 'a viewer cannot start a campaign'));
select t(throws_ok($$ select gateway.vl_start_campaign('22222222-2222-4222-8222-222222222222'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, current_setting('t21.env')::uuid, 'x', null, 1, '{}'::jsonb, 1) $$, '55000', null, 'another tenant cannot run a campaign in this tenant''s environment'));
select t(is(gateway.vl_cancel_campaign('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000004'::uuid, current_setting('t21.campaign')::uuid), 'forbidden', 'a viewer cannot cancel'));
select t(is(gateway.vl_cancel_campaign('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, current_setting('t21.campaign')::uuid), 'ok', 'a developer can'));
select gateway.vl_set_campaign('11111111-1111-4111-8111-111111111111'::uuid, current_setting('t21.campaign')::uuid, 'expired', null, null);
select t(ok((select finished_at is not null and status = 'expired' from public.validation_campaigns where id = current_setting('t21.campaign')::uuid), 'an expired campaign is finished'));
select t(is(gateway.vl_cancel_campaign('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, current_setting('t21.campaign')::uuid), 'not_active', 'and can no longer be cancelled'));

-- run, steps (append-only), a finding with a remediation
select set_config('t21.run', gateway.vl_record_run('11111111-1111-4111-8111-111111111111'::uuid, current_setting('t21.campaign')::uuid,
  jsonb_build_object('scenarioVersionId', current_setting('t21.sv'), 'scenarioKey', 'scenario-21', 'scenarioVersion', 1, 'seed', 7, 'status', 'completed', 'verdict', 'fail'))::text, true);
select gateway.vl_record_steps('11111111-1111-4111-8111-111111111111'::uuid, current_setting('t21.run')::uuid,
  '[{"seq":0,"stepKey":"s0","kind":"attack","action":"authorize","label":"attack","verdict":"fail"}]'::jsonb);
select t(throws_ok($$ update public.validation_steps set verdict = 'pass' where run_id = current_setting('t21.run')::uuid $$, '23514', null, 'recorded steps cannot be rewritten'));
select t(throws_ok($$ delete from public.validation_steps where run_id = current_setting('t21.run')::uuid $$, '23514', null, 'or deleted'));
select gateway.vl_record_findings('11111111-1111-4111-8111-111111111111'::uuid, current_setting('t21.campaign')::uuid, current_setting('t21.run')::uuid,
  jsonb_build_array(jsonb_build_object('stepSeq', 0, 'scenarioKey', 'scenario-21', 'severity', 'high', 'category', 'x', 'cause', 'wrong_resource', 'title', 'leak', 'summary', 's',
    'remediations', jsonb_build_array(jsonb_build_object('kind', 'narrow_resource_binding', 'title', 't', 'broadensAuthority', false, 'requiresHumanReview', true)))));
select set_config('t21.rem', (select r.id::text from public.validation_remediations r join public.validation_findings f on f.id = r.finding_id where f.campaign_id = current_setting('t21.campaign')::uuid limit 1), true);
select t(is((select status from public.validation_remediations where id = current_setting('t21.rem')::uuid), 'proposed', 'a new remediation is only a proposal'));
select t(throws_ok($$ update public.validation_remediations set proposal = proposal || '{"broadensAuthority": true}' where id = current_setting('t21.rem')::uuid $$, '23514', null, 'the database refuses a proposal that claims to broaden authority'));
select t(throws_ok($$ insert into public.validation_remediations (tenant_id, finding_id, kind, proposal) select tenant_id, finding_id, 'x', '{"broadensAuthority": true}' from public.validation_remediations limit 1 $$, '23514', null, 'and refuses one inserted that way'));

-- Reads are tenant-scoped.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}'; -- viewer.a
select t(is((select count(*)::int from public.validation_campaigns), 1, 'a tenant member sees its campaign'));
select t(is((select count(*)::int from public.validation_steps), 1, 'and its steps'));
select t(is((select count(*)::int from public.validation_findings), 1, 'and its findings'));
select t(throws_ok($$ insert into public.validation_findings (tenant_id) values ('11111111-1111-4111-8111-111111111111') $$, '42501', null, 'a client cannot forge a finding'));
select t(throws_ok($$ update public.validation_campaigns set status = 'completed' $$, '42501', null, 'a client cannot edit a campaign'));
select t(throws_ok($$ delete from public.validation_runs $$, '42501', null, 'or delete a run'));
select t(throws_ok($$ select gateway.vl_start_campaign('11111111-1111-4111-8111-111111111111'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid, current_setting('t21.env')::uuid, 'x', null, 1, '{}'::jsonb, 1) $$, '42501', null, 'a signed-in user cannot call the gateway functions'));
select t(throws_ok($$ select public.decide_validation_remediation(current_setting('t21.rem')::uuid, 'accept', '') $$, '42501', null, 'a viewer cannot decide a remediation'));
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}'; -- dev.a
select t(throws_ok($$ select public.decide_validation_remediation(current_setting('t21.rem')::uuid, 'accept', '') $$, '42501', null, 'nor can a developer'));
set local request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}'; -- owner.b
select t(is((select count(*)::int from public.validation_campaigns), 0, 'another tenant sees none of it'));
select t(throws_ok($$ select public.decide_validation_remediation(current_setting('t21.rem')::uuid, 'accept', '') $$, 'P0002', null, 'and cannot even tell that the remediation exists'));
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}'; -- admin.a
select t(is(public.decide_validation_remediation(current_setting('t21.rem')::uuid, 'accept', 'ok'), 'accepted', 'an admin can accept'));
select t(is(public.decide_validation_remediation(current_setting('t21.rem')::uuid, 'reject', 'changed my mind'), 'accepted', 'a decision, once made, is final'));
select t(is((select f.status from public.validation_findings f join public.validation_remediations r on r.finding_id = f.id where r.id = current_setting('t21.rem')::uuid), 'accepted', 'the finding follows the decision'));
select t(throws_ok($$ select public.set_retention_settings('11111111-1111-4111-8111-111111111111'::uuid, 3) $$, '22023', null, 'retention below 7 days is refused'));
select t(is(public.set_retention_settings('11111111-1111-4111-8111-111111111111'::uuid, 14), 14, 'an admin can set retention'));
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}'; -- viewer.a
select t(throws_ok($$ select public.set_retention_settings('11111111-1111-4111-8111-111111111111'::uuid, 60) $$, '42501', null, 'a viewer cannot'));
select t(throws_ok($$ select * from public.github_webhook_retries $$, '42501', null, 'webhook retry rows are not readable by clients'));
set local role postgres;

-- =====================================================================
-- 4. Retention purge removes only aged validation artifacts, never audit records.
-- =====================================================================
update public.validation_campaigns set finished_at = now() - interval '20 days' where id = current_setting('t21.campaign')::uuid;
select set_config('t21.audit_before', (select count(*)::text from public.authorization_decisions), true);
select gateway.retention_purge(100);
select t(is((select count(*)::int from public.validation_campaigns where id = current_setting('t21.campaign')::uuid), 0, 'a campaign older than the tenant''s retention (14 days) is purged, with its steps and findings'));
select t(is((select count(*)::text from public.authorization_decisions), current_setting('t21.audit_before'), 'and no authorization decision is touched'));
select t(is((select count(*)::int from public.validation_scenario_versions where id = current_setting('t21.sv')::uuid), 1, 'immutable scenario versions are kept so history stays reproducible'));

-- =====================================================================
-- 5. Webhook retry queue and the schema-version probe.
-- =====================================================================
select gateway.webhook_retry_enqueue('t21-delivery-0001', 'installation', 'suspend', 1234567, '{}'::bigint[]);
select gateway.webhook_retry_enqueue('t21-delivery-0001', 'installation', 'suspend', 1234567, '{}'::bigint[]);
select t(is((select count(*)::int from public.github_webhook_retries where delivery_id = 't21-delivery-0001'), 1, 'a retried delivery is queued once'));
select t(is((select count(*)::int from gateway.webhook_retry_due(50) where r_delivery_id = 't21-delivery-0001'), 1, 'and is due immediately'));
select gateway.webhook_retry_mark('t21-delivery-0001', false, 'timeout');
select t(is((select count(*)::int from gateway.webhook_retry_due(50) where r_delivery_id = 't21-delivery-0001'), 0, 'a failed attempt backs off'));
select t(throws_ok($$ insert into public.github_webhook_retries (delivery_id, event, github_installation_id) values ('t21-bad-event-00', 'push', 1) $$, '23514', null, 'only installation events are queued'));
-- This literal must track the newest migration's own gateway.schema_version()
-- (see src/lib/gateway/schema-version.ts's EXPECTED_SCHEMA_VERSION, which the
-- application checks against at startup) -- it is not meant to pin one
-- specific migration forever, just to prove the probe reports whatever the
-- newest one actually set.
select t(is(gateway.schema_version(), '20261003000013', 'the schema-version probe reports the newest migration'));
