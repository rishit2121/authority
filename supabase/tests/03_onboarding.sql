-- public.ensure_onboarded(): idempotency, isolation and failure modes.
--
-- A fresh auth.users row is created inside the suite's transaction, so these
-- assertions run against a genuinely un-onboarded user and are rolled back.

select plan(11);

-- A user who has signed up but never hit a protected route.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  'c0000000-0000-4000-8000-0000000000ff',
  'authenticated', 'authenticated',
  'fresh.user@authority.test',
  extensions.crypt('Authority-Dev-2026!', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Fresh User"}'::jsonb,
  false, false,
  '', '', '', '', '', '', '', ''
);

-- ---------------------------------------------------------------------------
-- Unauthenticated callers.
-- ---------------------------------------------------------------------------

select t(
  throws_ok(
    $$ set local role anon; select * from public.ensure_onboarded() $$,
    '42501',
    null,
    'anon has no EXECUTE privilege on ensure_onboarded()'
  )
);

-- ---------------------------------------------------------------------------
-- First call: creates profile, tenant and owner membership.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"c0000000-0000-4000-8000-0000000000ff","role":"authenticated"}';

select t(
  is(
    (select was_created from public.ensure_onboarded()),
    true,
    'first call reports that it created a workspace'
  )
);

select t(
  is(
    (select display_name from public.profiles
      where user_id = 'c0000000-0000-4000-8000-0000000000ff'),
    'Fresh User',
    'profile takes display_name from the signup metadata'
  )
);

select t(
  is(
    (select role::text from public.tenant_memberships
      where user_id = 'c0000000-0000-4000-8000-0000000000ff'),
    'owner',
    'the new user owns their default workspace'
  )
);

select t(
  is(
    (select count(*) from public.tenant_memberships
      where user_id = 'c0000000-0000-4000-8000-0000000000ff')::int,
    1,
    'exactly one membership is created'
  )
);

select t(
  matches(
    (select t2.slug from public.tenants t2
      join public.tenant_memberships m on m.tenant_id = t2.id
      where m.user_id = 'c0000000-0000-4000-8000-0000000000ff'),
    '^fresh-user',
    'the workspace slug is normalized from the display name'
  )
);

-- ---------------------------------------------------------------------------
-- Idempotency: calling again must not mint a second workspace.
-- ---------------------------------------------------------------------------

select t(
  is(
    (select was_created from public.ensure_onboarded()),
    false,
    'second call reports that nothing was created'
  )
);

select t(
  is(
    (select count(*) from public.tenant_memberships
      where user_id = 'c0000000-0000-4000-8000-0000000000ff')::int,
    1,
    'a second call adds no membership'
  )
);

-- Five more calls, as a retry storm would produce.
select public.ensure_onboarded();
select public.ensure_onboarded();
select public.ensure_onboarded();
select public.ensure_onboarded();
select public.ensure_onboarded();

select t(
  is(
    (select count(*) from public.tenants t2
      join public.tenant_memberships m on m.tenant_id = t2.id
      where m.user_id = 'c0000000-0000-4000-8000-0000000000ff')::int,
    1,
    'seven calls in total still yield exactly one workspace'
  )
);

-- Onboarding must resolve to the same tenant every time, or the UI would
-- silently switch workspaces between requests.
select t(
  is(
    (select tenant_id from public.ensure_onboarded()),
    (select tenant_id from public.ensure_onboarded()),
    'repeated calls resolve to the same tenant id'
  )
);

-- ---------------------------------------------------------------------------
-- Slug collision handling.
-- ---------------------------------------------------------------------------

reset role;

select t(
  isnt(
    (select authz.unique_tenant_slug('Northwind Labs')),
    'northwind-labs',
    'a colliding slug is suffixed rather than reused'
  )
);
