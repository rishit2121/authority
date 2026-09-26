-- Part 5: semantic-risk shadow evaluation schema.
--
-- Trust model, stated plainly: authorize_tool_call() is directly callable by
-- anyone holding an agent runtime key, so PostgreSQL cannot prove that a
-- semantic model ever ran, or that the numbers recorded here came from one.
-- Everything in this migration is therefore *shadow-only, non-authoritative
-- evidence*: it is enforced at the storage layer (CHECK constraints, not
-- convention) that a row can only ever be mode = 'shadow', authoritative =
-- false and attestation = 'unattested', and no code path in the database
-- reads these rows when deciding anything. Semantic enforcement is
-- deliberately not representable: settings can never hold mode = 'enforce'.

create type public.semantic_mode as enum ('off', 'shadow', 'enforce');
create type public.semantic_evidence_state as enum
  ('ok', 'timeout', 'error', 'unavailable', 'circuit_open');
create type public.semantic_risk_level as enum ('low', 'medium', 'high', 'critical', 'unknown');
create type public.semantic_disagreement as enum
  ('none', 'semantic_flags_permitted', 'semantic_clears_denied');

-- Per-tenant configuration. Never holds a secret: the provider API key lives
-- only in the server environment, and the provider base URL is not tenant-
-- configurable at all (a tenant-supplied URL would be an SSRF vector).
create table public.semantic_settings (
  tenant_id   uuid primary key references public.tenants (id) on delete cascade,
  mode        public.semantic_mode not null default 'off',
  provider    text not null default 'mock' check (provider in ('mock', 'openai_compatible', 'legacy_lexical')),
  model       text not null default 'mock-heuristic' check (model ~ '^[A-Za-z0-9._:/-]{1,100}$'),
  timeout_ms  integer not null default 800 check (timeout_ms between 100 and 5000),
  updated_at  timestamptz not null default now(),
  updated_by_principal_id uuid,
  foreign key (updated_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  -- Enforcement is unavailable until a trusted gateway can prevent bypass of
  -- the direct authorization RPC (see docs/semantic/SHADOW_MODE.md).
  constraint semantic_settings_enforce_unavailable check (mode <> 'enforce')
);

create table public.semantic_settings_audit (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  actor_principal_id uuid,
  previous_settings jsonb,
  new_settings jsonb not null,
  created_at  timestamptz not null default now(),
  foreign key (actor_principal_id, tenant_id) references public.principals (id, tenant_id)
);

create table public.semantic_shadow_evaluations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  task_id     uuid not null,
  tool_request_id uuid not null,
  authorization_decision_id uuid not null,
  agent_id    uuid not null,
  mode        public.semantic_mode not null default 'shadow',
  authoritative boolean not null default false,
  attestation text not null default 'unattested',
  evidence_schema_version integer not null default 1,
  provider    text not null check (char_length(btrim(provider)) between 1 and 100),
  model       text not null check (char_length(btrim(model)) between 1 and 200),
  model_version text not null check (char_length(btrim(model_version)) between 1 and 100),
  state       public.semantic_evidence_state not null,
  -- {"schemaVersion":1,"taskAlignment":p,...} — null exactly when state <> 'ok'.
  signals     jsonb,
  indicators  text[] not null default '{}',
  risk_level  public.semantic_risk_level not null,
  confidence  double precision not null check (confidence >= 0 and confidence <= 1),
  latency_ms  integer not null check (latency_ms >= 0 and latency_ms <= 600000),
  disagreement public.semantic_disagreement not null default 'none',
  -- SHA-256 of the *redacted* canonical payload sent to the provider. The
  -- payload itself is never stored, so this table cannot leak arguments.
  input_hash  text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  -- Counts only: {"schemaVersion":1,"counts":{kind:n},"truncated":bool,...}
  redaction_summary jsonb not null default '{"schemaVersion":1}'::jsonb
    check (pg_column_size(redaction_summary) <= 2048),
  error_category text check (error_category is null or error_category ~ '^[a-z_]{1,40}$'),
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  -- One evaluation per decision: a replay can never overwrite or add a second
  -- opinion, so evidence cannot be re-rolled until it looks favorable.
  unique (authorization_decision_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (tool_request_id, tenant_id) references public.tool_requests (id, tenant_id),
  foreign key (authorization_decision_id, tenant_id) references public.authorization_decisions (id, tenant_id),
  foreign key (agent_id, tenant_id) references public.agents (id, tenant_id),
  constraint semantic_shadow_only check (mode = 'shadow'),
  constraint semantic_never_authoritative check (authoritative = false),
  constraint semantic_always_unattested check (attestation = 'unattested'),
  constraint semantic_schema_version check (evidence_schema_version = 1),
  constraint semantic_signals_iff_ok check ((state = 'ok') = (signals is not null)),
  constraint semantic_unknown_risk_when_not_ok check (state = 'ok' or risk_level = 'unknown'),
  constraint semantic_indicators_bounded check (cardinality(indicators) <= 16)
);

comment on table public.semantic_shadow_evaluations is
  'Shadow-only, non-authoritative semantic observations linked to the exact '
  'tool request and deterministic decision. Nothing in the database reads '
  'these rows when deciding authorization. Append-only. Unattested: a holder '
  'of an agent runtime key can record evidence for their own decisions, so '
  'these rows must never be treated as proof a model ran.';

create index semantic_shadow_evaluations_tenant_created_idx
  on public.semantic_shadow_evaluations (tenant_id, created_at desc);
create index semantic_shadow_evaluations_task_idx
  on public.semantic_shadow_evaluations (task_id, created_at);

create trigger semantic_shadow_evaluations_append_only
  before update or delete on public.semantic_shadow_evaluations
  for each row execute function authz.forbid_update_delete();
create trigger semantic_settings_audit_append_only
  before update or delete on public.semantic_settings_audit
  for each row execute function authz.forbid_update_delete();

alter table public.semantic_settings enable row level security;
alter table public.semantic_settings_audit enable row level security;
alter table public.semantic_shadow_evaluations enable row level security;

revoke all on public.semantic_settings, public.semantic_settings_audit, public.semantic_shadow_evaluations
  from public, anon, authenticated;
grant select on public.semantic_settings, public.semantic_settings_audit, public.semantic_shadow_evaluations
  to authenticated;

create policy "semantic_settings_select_within_tenant"
  on public.semantic_settings for select to authenticated
  using (authz.is_member_of(tenant_id));
create policy "semantic_settings_audit_select_by_security_admin"
  on public.semantic_settings_audit for select to authenticated
  using (authz.has_min_role(tenant_id, 'security_admin'));
create policy "semantic_shadow_evaluations_select_within_tenant"
  on public.semantic_shadow_evaluations for select to authenticated
  using (authz.is_member_of(tenant_id));
