-- Part 2A development seed.
--
-- DEVELOPMENT DATA ONLY. Every address is under the reserved-for-testing
-- `.test` TLD and every account shares one well-known password. This file must
-- never be applied to a project holding real users. It is the fixture set the
-- RLS tests and the authenticated Playwright suite sign in as.
--
-- The password below is a fixture, not a secret: it grants access only to
-- throwaway accounts in a development project. Playwright reads the same value
-- from E2E_TEST_PASSWORD, defaulting to this string.
--
--   password (all seeded users): Authority-Dev-2026!
--
-- Shape of the fixture, chosen to cover the required test matrix:
--
--   Northwind Labs   (tenant A)  owner / admin / developer / viewer
--   Globex Payments  (tenant B)  owner
--
-- That gives two users in different tenants for isolation tests, and one
-- tenant carrying four distinct roles for escalation tests.
--
-- Idempotent: re-running changes nothing. It never deletes.

-- Fixed UUIDs so reruns are stable and tests can hardcode identities.
do $$
declare
  v_pwd text := extensions.crypt('Authority-Dev-2026!', extensions.gen_salt('bf'));
  v_users jsonb := '[
    {"id":"a0000000-0000-4000-8000-000000000001","email":"owner.a@authority.test","name":"Ada Owner"},
    {"id":"a0000000-0000-4000-8000-000000000002","email":"admin.a@authority.test","name":"Amin Admin"},
    {"id":"a0000000-0000-4000-8000-000000000003","email":"dev.a@authority.test","name":"Devi Developer"},
    {"id":"a0000000-0000-4000-8000-000000000004","email":"viewer.a@authority.test","name":"Vera Viewer"},
    {"id":"b0000000-0000-4000-8000-000000000001","email":"owner.b@authority.test","name":"Bo Owner"}
  ]'::jsonb;
  v_user jsonb;
  v_id uuid;
begin
  for v_user in select * from jsonb_array_elements(v_users)
  loop
    v_id := (v_user ->> 'id')::uuid;

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      is_sso_user, is_anonymous,
      -- GoTrue scans these into non-nullable strings. Leaving them NULL makes
      -- every sign-in fail with "Database error querying schema", so they are
      -- set explicitly rather than left to column defaults.
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      v_id,
      'authenticated',
      'authenticated',
      v_user ->> 'email',
      v_pwd,
      -- Pre-confirmed: the project requires email confirmation, and a seeded
      -- fixture has no inbox to click through.
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('display_name', v_user ->> 'name'),
      false, false,
      '', '', '', '', '', '', '', ''
    )
    on conflict (id) do nothing;

    -- GoTrue resolves a password login through auth.identities, so a user row
    -- alone is not sign-in-able.
    insert into auth.identities (
      id, user_id, provider, provider_id, identity_data,
      created_at, updated_at, last_sign_in_at
    )
    values (
      gen_random_uuid(),
      v_id,
      'email',
      v_id::text,
      jsonb_build_object('sub', v_id::text, 'email', v_user ->> 'email',
                         'email_verified', true, 'phone_verified', false),
      now(), now(), now()
    )
    on conflict (provider, provider_id) do nothing;
  end loop;
end $$;

-- Tenants. created_by points at each tenant's own owner.
insert into public.tenants (id, name, slug, environment, created_by)
values
  ('11111111-1111-4111-8111-111111111111', 'Northwind Labs', 'northwind-labs',
   'development', 'a0000000-0000-4000-8000-000000000001'),
  ('22222222-2222-4222-8222-222222222222', 'Globex Payments', 'globex-payments',
   'development', 'b0000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

-- Memberships: four roles in tenant A, one owner in tenant B.
insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000002', 'admin'),
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000003', 'developer'),
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000004', 'viewer'),
  ('22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-000000000001', 'owner')
on conflict (tenant_id, user_id) do nothing;

-- Profiles, matching what ensure_onboarded() would have produced.
insert into public.profiles (user_id, display_name)
select (u ->> 'id')::uuid, u ->> 'name'
from jsonb_array_elements('[
  {"id":"a0000000-0000-4000-8000-000000000001","name":"Ada Owner"},
  {"id":"a0000000-0000-4000-8000-000000000002","name":"Amin Admin"},
  {"id":"a0000000-0000-4000-8000-000000000003","name":"Devi Developer"},
  {"id":"a0000000-0000-4000-8000-000000000004","name":"Vera Viewer"},
  {"id":"b0000000-0000-4000-8000-000000000001","name":"Bo Owner"}
]'::jsonb) as u
on conflict (user_id) do nothing;
