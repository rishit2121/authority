-- Embedded customer connections, part 1: tenant-scoped applications and the
-- external customers they authenticate.
--
-- Today a `tenant` is the only scoping boundary above an agent/task, and
-- every human actor is a Supabase Auth user with a `principals` row. Neither
-- fits a developer's own end users: Alex signs into Acme's application, not
-- Authority, and must never need a Supabase account, an invitation, or a
-- password here. `applications` gives one tenant room for more than one
-- product surface (e.g. "Acme Web", "Acme Mobile") without disturbing the
-- existing single-tenant-wide dashboard model -- a tenant with exactly one
-- application behaves exactly like today. `customers` is the external,
-- opaque-ID-keyed identity record Acme's backend asserts on Alex's behalf;
-- it is deliberately NOT a `principals` row and NOT linked to `auth.users`,
-- since a customer is never meant to be capable of signing into this
-- dashboard the way a principal's optional `user_id` implies.

create table public.applications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  slug        text not null
    check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' and char_length(slug) between 2 and 63),
  environment public.tenant_environment not null default 'development',
  status      text not null default 'active' check (status in ('active', 'disabled')),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, tenant_id),
  unique (tenant_id, slug)
);

comment on table public.applications is
  'A developer''s product surface within one tenant (e.g. "Acme Web"). '
  'Scopes external customers, connections, and developer backend '
  'credentials below the tenant. A tenant with exactly one application is '
  'the common case and behaves exactly like the pre-existing single-app '
  'tenant model.';

create trigger applications_touch_updated_at
  before update on public.applications
  for each row execute function authz.touch_updated_at();

alter table public.applications enable row level security;
revoke all on public.applications from public, anon, authenticated;
grant select on public.applications to authenticated;
create policy "applications_select_within_tenant" on public.applications
  for select to authenticated using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- External customers: Alex, Bob, ... one row per (application, external id).
-- Never a dashboard user. The application backend is trusted to assert this
-- external id from its own verified login session -- see
-- gateway.create_or_resolve_customer in a later migration, which is the
-- only way a row here is ever created, always keyed by a developer backend
-- credential's own application_id, never a caller-supplied tenant/app.
-- ---------------------------------------------------------------------------
create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  application_id uuid not null,
  -- Opaque, developer-chosen -- never email. Email can be reused, reassigned,
  -- or changed out of band; an opaque id is the application's own durable
  -- primary key for this person, exactly what it would use for anything else.
  external_id   text not null check (char_length(btrim(external_id)) between 1 and 200),
  display_label text check (display_label is null or char_length(display_label) <= 200),
  status        text not null default 'active' check (status in ('active', 'disabled')),
  -- Small, schema-versioned, developer-opaque. Never a place for secrets --
  -- this is readable by any tenant member, same as everything else here.
  metadata      jsonb not null default '{"schemaVersion": 1}'::jsonb
    check (authz.has_allowed_schema_version(metadata, array[1]) and pg_column_size(metadata) <= 4096),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, tenant_id),
  -- Uniqueness is within one application's namespace, not the whole tenant:
  -- two applications in the same tenant may each have their own idea of
  -- external id "42" without colliding.
  unique (application_id, external_id),
  foreign key (application_id, tenant_id) references public.applications (id, tenant_id)
);

comment on table public.customers is
  'An application''s own end user, identified by an opaque external id the '
  'application backend supplies. Not a Supabase Auth user, never invited, '
  'never has a password here, and cannot sign into this dashboard.';

create trigger customers_touch_updated_at
  before update on public.customers
  for each row execute function authz.touch_updated_at();

create index customers_application_idx on public.customers (application_id, created_at);

alter table public.customers enable row level security;
revoke all on public.customers from public, anon, authenticated;
grant select on public.customers to authenticated;
create policy "customers_select_within_tenant" on public.customers
  for select to authenticated using (authz.is_member_of(tenant_id));

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000001'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
