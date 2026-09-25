-- Part 2B.1: organization policies and integration metadata.

create table public.policies (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  description text,
  version     integer not null default 1 check (version > 0),
  status      public.policy_status not null default 'draft',
  effect      public.policy_effect not null,
  -- {"schemaVersion":1,"rules":[{key,matches}]}
  conditions  jsonb not null default '{"schemaVersion": 1, "rules": []}'::jsonb
    check (authz.has_allowed_schema_version(conditions, array[1])),
  created_by  uuid references auth.users (id) on delete set null,
  demo_key    text,
  created_at  timestamptz not null default now(),
  activated_at timestamptz,
  unique (id, tenant_id),
  unique (tenant_id, name, version)
);

comment on table public.policies is
  'Organization policy, evaluated deterministically alongside the Task '
  'Authority Contract. Immutable once status = active (trigger in a later '
  'migration): changing an activated policy creates a new (name, version) '
  'row rather than editing this one.';

create unique index policies_tenant_demo_key_idx
  on public.policies (tenant_id, demo_key) where demo_key is not null;

create table public.integrations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  provider    public.integration_provider not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 200),
  status      public.integration_status not null default 'not_connected',
  -- Metadata only. No OAuth token, password, private key or service
  -- credential is ever stored in this table or anywhere else in this schema.
  configured_scopes_metadata jsonb default '{"schemaVersion": 1, "scopes": []}'::jsonb
    check (configured_scopes_metadata is null
      or authz.has_allowed_schema_version(configured_scopes_metadata, array[1])),
  health_metadata jsonb default '{"schemaVersion": 1}'::jsonb
    check (health_metadata is null or authz.has_allowed_schema_version(health_metadata, array[1])),
  created_by  uuid references auth.users (id) on delete set null,
  demo_key    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, tenant_id),
  unique (tenant_id, provider)
);

comment on table public.integrations is
  'Connected tool provider metadata only. No credential of any kind is '
  'stored here — see the column comment above. Real connection, scope '
  'enforcement and credential isolation are future phases.';

create trigger integrations_touch_updated_at
  before update on public.integrations
  for each row execute function authz.touch_updated_at();

create unique index integrations_tenant_demo_key_idx
  on public.integrations (tenant_id, demo_key) where demo_key is not null;
