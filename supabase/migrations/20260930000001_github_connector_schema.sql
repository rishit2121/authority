-- Part 7: GitHub connector schema.
--
-- What is and is not stored, stated once:
--   * Installation ids, account names and repository metadata: yes.
--   * The App private key, the webhook secret, the OAuth client secret,
--     installation access tokens, user access tokens: NEVER, in any table.
--     They live in the deployment secret boundary (server env) and installation
--     tokens exist only in process memory for the duration of one execution.
--   * GitHub response bodies, issue text, file contents: never. Receipts hold
--     identifiers, hashes and categories only.
--
-- Everything here is written by SECURITY DEFINER gateway functions (next
-- migrations); clients get row-level SELECT only.

-- ---------------------------------------------------------------------------
-- Installations: exactly one tenant may own a GitHub installation, ever.
-- ---------------------------------------------------------------------------
create table public.github_installations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  github_installation_id bigint not null unique check (github_installation_id > 0),
  -- 'mock' installations exist only for development/tests and can never execute live.
  mode        text not null check (mode in ('mock', 'live')),
  account_login text not null check (account_login ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
  account_type text not null check (account_type in ('User', 'Organization')),
  github_account_id bigint not null check (github_account_id > 0),
  repository_selection text not null check (repository_selection in ('all', 'selected')),
  -- {"metadata":"read","contents":"write",...} as reported by GitHub.
  granted_permissions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(granted_permissions) = 'object' and pg_column_size(granted_permissions) <= 2048),
  subscribed_events text[] not null default '{}'::text[] check (cardinality(subscribed_events) <= 32),
  status      text not null default 'active'
    check (status in ('active', 'suspended', 'permission_drift', 'disconnected')),
  -- Machine-readable reasons, e.g. PERMISSION_EXTRA:administration.
  health_reasons text[] not null default '{}'::text[] check (cardinality(health_reasons) <= 32),
  last_verified_at timestamptz,
  connected_by_principal_id uuid,
  connected_at timestamptz not null default now(),
  suspended_at timestamptz,
  disconnected_at timestamptz,
  disconnected_by_principal_id uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (connected_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  foreign key (disconnected_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  constraint github_installation_disconnect_consistent check ((status = 'disconnected') = (disconnected_at is not null))
);
create unique index github_installations_one_live_per_tenant
  on public.github_installations (tenant_id) where status <> 'disconnected';
create trigger github_installations_touch_updated_at
  before update on public.github_installations
  for each row execute function authz.touch_updated_at();

comment on table public.github_installations is
  'Tenant-to-GitHub-App-installation mapping. github_installation_id is globally '
  'unique so one tenant can never use another tenant''s installation. No token or '
  'key of any kind is stored here.';

-- ---------------------------------------------------------------------------
-- Repositories discovered inside an installation. `allowed` is the explicit
-- allowlist: discovery alone grants nothing.
-- ---------------------------------------------------------------------------
create table public.github_repositories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  installation_row_id uuid not null,
  github_repository_id bigint not null check (github_repository_id > 0),
  owner       text not null check (owner ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
  name        text not null check (name ~ '^[A-Za-z0-9._-]{1,100}$'),
  full_name_lc text generated always as (lower(owner || '/' || name)) stored,
  default_branch text not null check (default_branch ~ '^[A-Za-z0-9._/-]{1,200}$'),
  is_private  boolean not null,
  archived    boolean not null default false,
  present     boolean not null default true,
  allowed     boolean not null default false,
  allowed_by_principal_id uuid,
  allowed_at  timestamptz,
  discovered_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, tenant_id),
  unique (installation_row_id, github_repository_id),
  foreign key (installation_row_id, tenant_id) references public.github_installations (id, tenant_id),
  foreign key (allowed_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  constraint github_repository_allowed_consistent check ((not allowed) or (allowed_at is not null))
);
create index github_repositories_lookup_idx on public.github_repositories (tenant_id, full_name_lc);
create trigger github_repositories_touch_updated_at
  before update on public.github_repositories
  for each row execute function authz.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Installation flow state. The nonce is stored only as a hash; the browser
-- holds the plaintext in an HttpOnly cookie, so a callback URL alone is never
-- enough to complete an installation.
-- ---------------------------------------------------------------------------
create table public.github_install_states (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  principal_id uuid not null,
  nonce_hash  text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  status      text not null default 'issued' check (status in ('issued', 'installation_reported', 'completed', 'rejected')),
  reported_installation_id bigint check (reported_installation_id is null or reported_installation_id > 0),
  reject_reason text check (reject_reason is null or reject_reason ~ '^[A-Z_]{1,60}$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  completed_at timestamptz,
  unique (id, tenant_id),
  foreign key (principal_id, tenant_id) references public.principals (id, tenant_id),
  constraint github_install_state_short_lived check (expires_at > created_at and expires_at - created_at <= interval '20 minutes')
);
create index github_install_states_tenant_idx on public.github_install_states (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Task-to-repository binding. One repository per task; immutable once written.
-- ---------------------------------------------------------------------------
create table public.task_repository_bindings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  task_id     uuid not null,
  repository_id uuid not null,
  bound_by_principal_id uuid not null,
  created_at  timestamptz not null default now(),
  unique (task_id),
  unique (id, tenant_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (repository_id, tenant_id) references public.github_repositories (id, tenant_id),
  foreign key (bound_by_principal_id, tenant_id) references public.principals (id, tenant_id)
);
create trigger task_repository_bindings_append_only
  before update or delete on public.task_repository_bindings
  for each row execute function authz.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Two-phase capability consumption.
--
--   available -> reserved -> consumed
--                        \-> released      (definitely not dispatched; use refunded)
--                        \-> failed        (GitHub definitively refused; use spent)
--                        \-> indeterminate (outcome unknown; use spent, never auto-retried)
--
-- capability_tokens.uses counts SPENT uses (consumed / failed / indeterminate);
-- reserved_uses counts uses currently held by an in-flight reservation.
-- ---------------------------------------------------------------------------
alter table public.capability_tokens
  add column reserved_uses integer not null default 0 check (reserved_uses >= 0),
  add column budget_released_uses integer not null default 0 check (budget_released_uses >= 0),
  add constraint capability_uses_reservations_and_release_within_max
    check (uses + reserved_uses + budget_released_uses <= max_uses);

-- The immutability guard already lists the binding columns explicitly, so the
-- new counters are free to move; add the forward-only rule for released budget.
create or replace function gateway.enforce_capability_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('authority.allow_demo_purge', true) = 'on' then return old; end if;
    raise exception 'capability tokens cannot be deleted' using errcode = '23514';
  end if;

  if (new.id, new.tenant_id, new.agent_id, new.task_id, new.credential_id, new.contract_id, new.contract_version,
      new.authorization_decision_id, new.final_decision_id, new.budget_capability_id, new.tool, new.operation,
      new.resource, new.resource_constraints, new.arguments_hash, new.max_uses, new.issued_at, new.expires_at,
      new.token_hash, new.format_version)
     is distinct from
     (old.id, old.tenant_id, old.agent_id, old.task_id, old.credential_id, old.contract_id, old.contract_version,
      old.authorization_decision_id, old.final_decision_id, old.budget_capability_id, old.tool, old.operation,
      old.resource, old.resource_constraints, old.arguments_hash, old.max_uses, old.issued_at, old.expires_at,
      old.token_hash, old.format_version) then
    raise exception 'a capability''s binding is immutable' using errcode = '23514';
  end if;

  if new.uses < old.uses then
    raise exception 'capability uses can only increase' using errcode = '23514';
  end if;
  if new.budget_released_uses < old.budget_released_uses then
    raise exception 'released budget can only increase' using errcode = '23514';
  end if;
  if old.status in ('consumed', 'revoked') and new.status is distinct from old.status then
    raise exception 'a % capability cannot change status', old.status using errcode = '23514';
  end if;
  if old.status = 'revoked' and (new.revoked_at, new.revoked_by, new.revocation_reason, new.uses)
       is distinct from (old.revoked_at, old.revoked_by, old.revocation_reason, old.uses) then
    raise exception 'a revoked capability is frozen' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- A revoked or expired capability's reserved uses may still settle (an
-- in-flight execution finishing), which the guard above permits for uses.
-- Reservation rows themselves: one per (capability, idempotency key).
create table public.capability_reservations (
  id          uuid primary key default gen_random_uuid(),   -- the execution id
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  capability_id uuid not null,
  agent_id    uuid not null,
  task_id     uuid not null,
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 1 and 200),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  tool        text not null check (tool ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  operation   text not null,
  status      text not null default 'reserved'
    check (status in ('reserved', 'consumed', 'released', 'failed', 'indeterminate')),
  execution_mode text not null check (execution_mode in ('mock', 'live')),
  installation_row_id uuid,
  github_installation_id bigint,
  repository_id uuid,
  repository_full_name text check (repository_full_name is null or char_length(repository_full_name) <= 200),
  reserved_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  dispatched_at timestamptz,
  finished_at timestamptz,
  reason_code text check (reason_code is null or reason_code ~ '^[A-Z_]{1,60}$'),
  -- Admin annotation of an indeterminate execution; never changes the spent use.
  resolved_outcome text check (resolved_outcome in ('executed', 'not_executed')),
  resolved_at timestamptz,
  resolved_by_principal_id uuid,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  unique (capability_id, idempotency_key),
  foreign key (capability_id, tenant_id) references public.capability_tokens (id, tenant_id),
  foreign key (agent_id, tenant_id) references public.agents (id, tenant_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (installation_row_id, tenant_id) references public.github_installations (id, tenant_id),
  foreign key (repository_id, tenant_id) references public.github_repositories (id, tenant_id),
  foreign key (resolved_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  constraint reservation_lease_after_reserved check (lease_expires_at > reserved_at and lease_expires_at - reserved_at <= interval '5 minutes'),
  constraint reservation_terminal_has_finish check ((status = 'reserved') = (finished_at is null)),
  constraint reservation_resolution_only_indeterminate check (resolved_outcome is null or status = 'indeterminate')
);
create index capability_reservations_capability_idx on public.capability_reservations (capability_id, created_at);
create index capability_reservations_open_lease_idx on public.capability_reservations (lease_expires_at) where status = 'reserved';
create index capability_reservations_task_idx on public.capability_reservations (task_id, created_at);

create or replace function gateway.enforce_reservation_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('authority.allow_demo_purge', true) = 'on' then return old; end if;
    raise exception 'capability reservations cannot be deleted' using errcode = '23514';
  end if;
  if (new.id, new.tenant_id, new.capability_id, new.agent_id, new.task_id, new.idempotency_key, new.request_hash,
      new.tool, new.operation, new.execution_mode, new.installation_row_id, new.github_installation_id,
      new.repository_id, new.repository_full_name, new.reserved_at, new.lease_expires_at)
     is distinct from
     (old.id, old.tenant_id, old.capability_id, old.agent_id, old.task_id, old.idempotency_key, old.request_hash,
      old.tool, old.operation, old.execution_mode, old.installation_row_id, old.github_installation_id,
      old.repository_id, old.repository_full_name, old.reserved_at, old.lease_expires_at) then
    raise exception 'a reservation''s binding is immutable' using errcode = '23514';
  end if;
  if old.status <> 'reserved' then
    -- Terminal: only the admin resolution of an indeterminate execution may be recorded, once.
    if (new.status, new.finished_at, new.dispatched_at, new.reason_code)
         is distinct from (old.status, old.finished_at, old.dispatched_at, old.reason_code) then
      raise exception 'a % reservation is final', old.status using errcode = '23514';
    end if;
    if old.resolved_outcome is not null and new.resolved_outcome is distinct from old.resolved_outcome then
      raise exception 'an indeterminate execution can be resolved only once' using errcode = '23514';
    end if;
  elsif new.dispatched_at is distinct from old.dispatched_at and old.dispatched_at is not null then
    raise exception 'dispatch time cannot change' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function gateway.enforce_reservation_transition() from public;
create trigger capability_reservations_guard
  before update or delete on public.capability_reservations
  for each row execute function gateway.enforce_reservation_transition();

-- ---------------------------------------------------------------------------
-- Receipts: evidence, not authority. Compact, append-only, tenant-isolated.
-- ---------------------------------------------------------------------------
create table public.github_execution_receipts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  execution_id uuid not null unique,
  task_id     uuid not null,
  agent_id    uuid not null,
  capability_id uuid not null,
  authorization_decision_id uuid not null,
  installation_row_id uuid,
  github_installation_id bigint,
  repository_id uuid,
  repository_full_name text check (repository_full_name is null or char_length(repository_full_name) <= 200),
  tool        text not null check (tool ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  operation   text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  execution_mode text not null check (execution_mode in ('mock', 'live')),
  result_category text not null check (result_category in ('succeeded', 'succeeded_noop', 'failed', 'indeterminate', 'released')),
  github_request_id text check (github_request_id is null or github_request_id ~ '^[A-Za-z0-9:._-]{1,100}$'),
  http_status_class smallint check (http_status_class is null or http_status_class between 1 and 5),
  -- Identifiers only: {"schemaVersion":1,"branch":"...","pullNumber":12,"htmlUrl":"https://github.com/..."}
  resource_ids jsonb not null default '{"schemaVersion":1}'::jsonb
    check (authz.has_allowed_schema_version(resource_ids, array[1]) and pg_column_size(resource_ids) <= 2048),
  before_sha  text check (before_sha is null or before_sha ~ '^[0-9a-f]{40}$'),
  after_sha   text check (after_sha is null or after_sha ~ '^[0-9a-f]{40}$'),
  started_at  timestamptz not null,
  finished_at timestamptz not null,
  -- Counts only: what was scrubbed from anything that would have been returned.
  redaction_metadata jsonb not null default '{"schemaVersion":1}'::jsonb
    check (authz.has_allowed_schema_version(redaction_metadata, array[1]) and pg_column_size(redaction_metadata) <= 1024),
  reason_code text check (reason_code is null or reason_code ~ '^[A-Z_]{1,60}$'),
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (agent_id, tenant_id) references public.agents (id, tenant_id),
  foreign key (capability_id, tenant_id) references public.capability_tokens (id, tenant_id),
  foreign key (authorization_decision_id, tenant_id) references public.authorization_decisions (id, tenant_id),
  foreign key (installation_row_id, tenant_id) references public.github_installations (id, tenant_id),
  foreign key (repository_id, tenant_id) references public.github_repositories (id, tenant_id),
  constraint receipt_result_has_reason check (result_category in ('succeeded', 'succeeded_noop') or reason_code is not null),
  constraint receipt_finish_after_start check (finished_at >= started_at)
);
create index github_execution_receipts_task_idx on public.github_execution_receipts (task_id, created_at);
create index github_execution_receipts_tenant_idx on public.github_execution_receipts (tenant_id, created_at desc);
create trigger github_execution_receipts_append_only
  before update or delete on public.github_execution_receipts
  for each row execute function authz.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- RLS: members read within their tenant; nothing here is client-writable.
-- ---------------------------------------------------------------------------
alter table public.github_installations enable row level security;
alter table public.github_repositories enable row level security;
alter table public.github_install_states enable row level security;
alter table public.task_repository_bindings enable row level security;
alter table public.capability_reservations enable row level security;
alter table public.github_execution_receipts enable row level security;

revoke all on public.github_installations, public.github_repositories, public.github_install_states,
  public.task_repository_bindings, public.capability_reservations, public.github_execution_receipts
  from public, anon, authenticated;
grant select on public.github_installations, public.github_repositories, public.task_repository_bindings,
  public.capability_reservations, public.github_execution_receipts to authenticated;
-- The state nonce hash is never client-readable; install states are not listed to clients at all.

create policy "github_installations_select_within_tenant" on public.github_installations
  for select to authenticated using (authz.is_member_of(tenant_id));
create policy "github_repositories_select_within_tenant" on public.github_repositories
  for select to authenticated using (authz.is_member_of(tenant_id));
create policy "task_repository_bindings_select_within_tenant" on public.task_repository_bindings
  for select to authenticated using (authz.is_member_of(tenant_id));
create policy "capability_reservations_select_within_tenant" on public.capability_reservations
  for select to authenticated using (authz.is_member_of(tenant_id));
create policy "github_execution_receipts_select_within_tenant" on public.github_execution_receipts
  for select to authenticated using (authz.is_member_of(tenant_id));
