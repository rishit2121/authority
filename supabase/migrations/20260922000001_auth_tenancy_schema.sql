-- Part 2A: authentication and tenant membership — schema.
--
-- Scope note: these tables model *authenticated application users* and the
-- organizations they belong to. They are deliberately NOT the domain's
-- `Principal`, which represents delegated human/service authority a task acts
-- under. A Principal may later reference a user_id; the two are not the same
-- thing and must not be conflated.

create schema if not exists authz;
comment on schema authz is
  'Private helpers for row-level security and onboarding. Not a client API surface.';

revoke all on schema authz from public;
grant usage on schema authz to authenticated;

-- Roles are an enum so an unknown role cannot be written at all. Order here is
-- presentational only; authority ordering is defined by authz.role_rank().
create type public.tenant_role as enum (
  'viewer',
  'developer',
  'security_admin',
  'admin',
  'owner'
);

create type public.tenant_environment as enum (
  'development',
  'staging',
  'production'
);

-- Keeps updated_at honest regardless of what the caller sends.
create or replace function authz.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function authz.touch_updated_at() from public, anon, authenticated;

create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    check (pg_catalog.char_length(pg_catalog.btrim(display_name)) between 1 and 120),
  -- Nullable, but never an arbitrary scheme: blocks javascript:/data: payloads
  -- reaching an <img src> later.
  avatar_url   text
    check (avatar_url is null or avatar_url ~ '^https://[^[:space:]]{3,2048}$'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Per-user application profile. A user may read and update only their own row.';

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function authz.touch_updated_at();

create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null
    check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 120),
  -- Stricter than the domain's ^[a-z0-9-]+$: no leading/trailing hyphen, so
  -- slugs stay URL-safe and comparable.
  slug        text not null unique
    check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
           and pg_catalog.char_length(slug) between 2 and 63),
  environment public.tenant_environment not null default 'development',
  -- restrict, not cascade: deleting a user must not silently destroy an
  -- organization other people still belong to.
  created_by  uuid not null references auth.users (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.tenants is
  'A customer organization. Readable only by users holding a membership in it.';

create trigger tenants_touch_updated_at
  before update on public.tenants
  for each row execute function authz.touch_updated_at();

create table public.tenant_memberships (
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.tenant_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Satisfies the required uniqueness of (tenant_id, user_id): one role per
  -- user per tenant, so there is no ambiguity about which role applies.
  primary key (tenant_id, user_id)
);

comment on table public.tenant_memberships is
  'Which users belong to which tenant, and with what role. The sole source of '
  'truth for tenant authorization; a cookie or client claim never is.';

create trigger tenant_memberships_touch_updated_at
  before update on public.tenant_memberships
  for each row execute function authz.touch_updated_at();

-- "My memberships" is the hottest read on the protected path.
create index tenant_memberships_user_id_idx
  on public.tenant_memberships (user_id);

create index tenant_memberships_tenant_role_idx
  on public.tenant_memberships (tenant_id, role);

create index tenants_created_by_idx on public.tenants (created_by);

-- Privileges are granted explicitly rather than inherited from a broad default.
-- anon gets nothing at all: unauthenticated access fails on privileges before
-- RLS is even consulted.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.tenants from anon, authenticated;
revoke all on table public.tenant_memberships from anon, authenticated;

grant select, insert, update on table public.profiles to authenticated;
grant select, update on table public.tenants to authenticated;
grant select, insert, update, delete on table public.tenant_memberships to authenticated;
