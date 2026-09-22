-- Part 2B.1: principals, agents, tasks.
--
-- Tenant-integrity pattern used throughout Part 2B, stated once here:
--
-- Every parent table gets `primary key (id)` plus a redundant
-- `unique (id, tenant_id)`. Every child references its parent through BOTH
-- columns: `foreign key (parent_id, tenant_id) references parent (id, tenant_id)`.
-- A row naming a real parent id from a *different* tenant then satisfies
-- neither unique constraint and the insert is rejected as an ordinary FK
-- violation — before RLS is even consulted, and regardless of which role or
-- function is performing the write. This is chosen over a trigger because it
-- is declarative and cannot be bypassed by anything, including a
-- SECURITY DEFINER function or the table owner. The cost is one extra unique
-- index per parent table.

create table public.principals (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  kind        public.principal_kind not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 200),
  email       text,
  -- Optional link to an authenticated application user. A principal is not
  -- necessarily a signed-up user — Part 1's `prin_maya` / `prin_security`
  -- fixtures represent delegated human authority that may or may not
  -- correspond to an account in this system yet.
  user_id     uuid references auth.users (id) on delete set null,
  -- Present on every product table; see supabase/migrations/*_demo_data.sql.
  -- NULL for anything created outside the demo installer.
  demo_key    text,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id)
);

comment on table public.principals is
  'Delegated human/service authority a task acts under. Not an authenticated '
  'application user — see profiles for that. May optionally reference one.';

create unique index principals_tenant_demo_key_idx
  on public.principals (tenant_id, demo_key) where demo_key is not null;

create index principals_tenant_id_idx on public.principals (tenant_id);

create table public.agents (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  description text,
  -- First-class query field. Kept separate from `model`/`framework` (which
  -- mirror the domain exactly) because "which vendor" is filtered on far more
  -- often than the specific model string.
  model_provider text not null check (char_length(btrim(model_provider)) between 1 and 100),
  model       text not null check (char_length(btrim(model)) between 1 and 200),
  framework   text not null check (char_length(btrim(framework)) between 1 and 100),
  owner_principal_id uuid not null,
  environment public.tenant_environment not null default 'development',
  risk_tier   public.agent_risk_tier not null default 'low',
  status      public.agent_status not null default 'active',
  demo_key    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (owner_principal_id, tenant_id) references public.principals (id, tenant_id)
);

comment on table public.agents is
  'A customer-owned agent. Authority never runs it; this records identity so '
  'decisions and capabilities can be attributed. description/model_provider/'
  'environment/risk_tier are database-only — dropped by the domain mapper, '
  'which validates only the fields agentSchema defines.';

create trigger agents_touch_updated_at
  before update on public.agents
  for each row execute function authz.touch_updated_at();

create unique index agents_tenant_demo_key_idx
  on public.agents (tenant_id, demo_key) where demo_key is not null;

create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  agent_id    uuid not null,
  principal_id uuid not null,
  -- The app user who caused this task to be created, when there was one.
  -- Distinct from principal_id: a principal is the trust-delegation identity
  -- a task's authority traces back to, which may differ from the operator
  -- who clicked the button. Database-only; dropped by the domain mapper.
  initiating_user_id uuid references auth.users (id) on delete set null,
  intent      text not null check (char_length(btrim(intent)) between 1 and 4000),
  -- Where the trusted intent came from (form, API, future integration).
  -- Database-only provenance; not part of the domain's trust model itself.
  trusted_context_provenance jsonb not null default '{"schemaVersion": 1, "source": "unspecified"}'::jsonb
    check (authz.has_allowed_schema_version(trusted_context_provenance, array[1])),
  status      public.task_status not null default 'pending',
  started_at    timestamptz,
  completed_at  timestamptz,
  -- Database-only bookkeeping. The domain's `completedAt` is sourced only
  -- from `completed_at`; a terminated task's precise termination instant is
  -- not yet part of the domain's Task shape.
  terminated_at timestamptz,
  demo_key    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (agent_id, tenant_id) references public.agents (id, tenant_id),
  foreign key (principal_id, tenant_id) references public.principals (id, tenant_id)
);

comment on table public.tasks is
  'A unit of delegated work. intent is trusted input from the human '
  'principal, never from the agent.';

create trigger tasks_touch_updated_at
  before update on public.tasks
  for each row execute function authz.touch_updated_at();

create unique index tasks_tenant_demo_key_idx
  on public.tasks (tenant_id, demo_key) where demo_key is not null;

-- No table privileges are granted to `anon` or `authenticated` in this file.
-- Privileges and RLS policies for every Part 2B table are granted together in
-- 20260923000008_product_rls.sql, so the access model for a table is never
-- split across migrations.
