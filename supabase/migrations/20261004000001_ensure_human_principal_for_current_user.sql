-- A real signed-in tenant member can reach the dashboard with zero
-- `principals` rows: ensure_onboarded() (20260922000004_onboarding.sql)
-- creates their profile/tenant/membership but never a principal, and the
-- one function that DOES lazily create one on first use --
-- gateway.actor_principal() (20260930000010, tightened in
-- 20261003000012) -- is reachable only by the gateway role, never by an
-- authenticated dashboard session. A fresh signup therefore hits
-- /app/agents/new with an empty, disabled "Owner" picker and no way to
-- register their first agent without the demo-data installer or manual
-- SQL.
--
-- This exposes the same idempotent, membership-gated, advisory-locked
-- logic gateway.actor_principal() already uses -- deliberately NOT by
-- granting `authenticated` execute on that gateway-schema function itself
-- (which would cross the gateway/dashboard trust boundary this schema
-- otherwise keeps strict; see src/tests/unit/gateway/boundary.test.ts),
-- but as its own public.* SECURITY DEFINER wrapper scoped to auth.uid()
-- and a tenant the caller is already a verified member of. Never creates a
-- principal in any other tenant; never grants a role. Resolves to the
-- caller's existing principal row instead of creating a duplicate if one
-- already exists -- including when they hold more than one, per the
-- documented multi-principal-per-user allowance
-- (20261003000012_contract_approval_identity_by_user.sql's own module
-- comment on why no unique (tenant_id, user_id) constraint exists): the
-- oldest row wins, the same tie-break every other caller in this schema
-- already uses.

create or replace function public.ensure_human_principal_for_current_user(p_tenant_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_id uuid;
  v_name text;
begin
  if v_user_id is null then
    raise exception 'ensure_human_principal_for_current_user() requires an authenticated caller'
      using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.tenant_memberships m
    where m.tenant_id = p_tenant_id and m.user_id = v_user_id
  ) then
    raise exception 'caller is not a member of this tenant' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('authority.ensure_human_principal:' || p_tenant_id::text || ':' || v_user_id::text, 0)
  );

  select p.id into v_id
  from public.principals p
  where p.tenant_id = p_tenant_id and p.user_id = v_user_id
  order by p.created_at, p.id
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select coalesce(
    nullif(pg_catalog.btrim(pr.display_name), ''),
    nullif(pg_catalog.split_part(u.email, '@', 1), ''),
    'Member'
  )
  into v_name
  from auth.users u
  left join public.profiles pr on pr.user_id = u.id
  where u.id = v_user_id;

  insert into public.principals (tenant_id, kind, display_name, email, user_id)
  select p_tenant_id, 'human', pg_catalog.left(coalesce(v_name, 'Member'), 200), u.email, v_user_id
  from auth.users u
  where u.id = v_user_id
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.ensure_human_principal_for_current_user(uuid) from public, anon;
grant execute on function public.ensure_human_principal_for_current_user(uuid) to authenticated;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261004000001'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
