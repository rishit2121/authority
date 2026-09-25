-- Part 2A: new-user onboarding.
--
-- Mechanism: an idempotent SECURITY DEFINER RPC invoked from the protected
-- application boundary as the authenticated user — not an AFTER INSERT trigger
-- on auth.users.
--
-- Why not the trigger: a trigger runs inside GoTrue's own signup transaction.
-- Any failure there surfaces to the user as an opaque "Database error saving
-- new user" and aborts account creation outright, which is the opposite of the
-- requirement that failure be visible and recoverable. It is also awkward to
-- test and cannot be retried.
--
-- This function instead runs on the first authenticated request, so a failure
-- is an ordinary error the application can surface and the next request can
-- retry. Correctness properties:
--
--   * Idempotent — an existing membership short-circuits tenant creation, and
--     the profile insert is ON CONFLICT DO NOTHING.
--   * Concurrency-safe — a transaction-scoped advisory lock keyed on the user
--     serializes parallel first requests, so two in-flight requests cannot
--     produce two personal workspaces.
--   * No partial state — profile, tenant and owner membership are written in
--     one transaction; any raise rolls back all three.
--   * No service-role key — it runs under the caller's own session and derives
--     identity from auth.uid(), so nothing privileged reaches the browser.

-- Lowercase, hyphen-collapsed, trimmed. Not security-sensitive on its own, but
-- pinned search_path anyway for consistency with the rest of authz.
create or replace function authz.slugify(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.lower(coalesce(p_text, '')),
      '[^a-z0-9]+', '-', 'g'
    ),
    '-'
  );
$$;

-- Normalizes a base string to a slug that is free at the time of the call.
-- The UNIQUE constraint on tenants.slug remains the real guarantee; this only
-- avoids losing a race in the common case.
create or replace function authz.unique_tenant_slug(p_base text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_base    text;
  v_slug    text;
  v_attempt integer := 0;
begin
  v_base := authz.slugify(p_base);

  -- Fall back rather than emitting an invalid slug: a display name of "!!!"
  -- or a single character slugifies to something the CHECK would reject.
  if v_base is null or pg_catalog.char_length(v_base) < 2 then
    v_base := 'workspace';
  end if;

  v_base := pg_catalog.left(v_base, 40);
  v_base := pg_catalog.btrim(v_base, '-');
  if pg_catalog.char_length(v_base) < 2 then
    v_base := 'workspace';
  end if;

  v_slug := v_base;

  loop
    exit when not exists (
      select 1 from public.tenants t where t.slug = v_slug
    );

    v_attempt := v_attempt + 1;

    if v_attempt > 50 then
      -- Stop scanning and take a collision-proof suffix instead of looping.
      v_slug := v_base || '-' ||
        pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
      exit;
    end if;

    v_slug := v_base || '-' || v_attempt::text;
  end loop;

  return v_slug;
end;
$$;

-- Ensures the caller has a profile, a workspace and an owner membership.
-- Safe and cheap to call on every protected request.
create or replace function public.ensure_onboarded()
returns table (tenant_id uuid, was_created boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id      uuid := (select auth.uid());
  v_email        text;
  v_display_name text;
  v_tenant_id    uuid;
  v_slug         text;
  v_created      boolean := false;
begin
  if v_user_id is null then
    raise exception 'ensure_onboarded() requires an authenticated caller'
      using errcode = '28000';
  end if;

  -- Transaction-scoped: released on commit or rollback, so a failed
  -- onboarding cannot wedge the user out of retrying.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('authority.onboarding:' || v_user_id::text, 0)
  );

  -- Read through to auth.users rather than trusting anything client-supplied.
  -- display_name falls back to the local part of the email so a profile always
  -- has something renderable.
  select
    u.email,
    coalesce(
      nullif(
        pg_catalog.btrim(u.raw_user_meta_data ->> 'display_name'), ''
      ),
      pg_catalog.split_part(u.email, '@', 1)
    )
  into v_email, v_display_name
  from auth.users u
  where u.id = v_user_id;

  if v_email is null then
    raise exception 'authenticated user has no email address; cannot onboard'
      using errcode = 'P0002';
  end if;

  v_display_name := pg_catalog.left(pg_catalog.btrim(v_display_name), 120);
  if pg_catalog.char_length(v_display_name) < 1 then
    v_display_name := 'New user';
  end if;

  insert into public.profiles (user_id, display_name)
  values (v_user_id, v_display_name)
  on conflict (user_id) do nothing;

  -- Any existing membership means this user is already onboarded. Ordering is
  -- deterministic so repeated calls resolve to the same tenant.
  select m.tenant_id
  into v_tenant_id
  from public.tenant_memberships m
  where m.user_id = v_user_id
  order by m.created_at asc, m.tenant_id asc
  limit 1;

  if v_tenant_id is null then
    v_slug := authz.unique_tenant_slug(v_display_name);

    insert into public.tenants (name, slug, environment, created_by)
    values (
      pg_catalog.left(v_display_name, 100) || ' workspace',
      v_slug,
      'development',
      v_user_id
    )
    returning id into v_tenant_id;

    insert into public.tenant_memberships (tenant_id, user_id, role)
    values (v_tenant_id, v_user_id, 'owner');

    v_created := true;
  end if;

  return query select v_tenant_id, v_created;
end;
$$;

revoke all on function authz.slugify(text) from public, anon;
revoke all on function authz.unique_tenant_slug(text) from public, anon, authenticated;
revoke all on function public.ensure_onboarded() from public, anon;

grant execute on function authz.slugify(text) to authenticated;
grant execute on function public.ensure_onboarded() to authenticated;
