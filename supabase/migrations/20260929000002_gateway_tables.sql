-- Part 6: enforcement settings, gateway-attested semantic evaluations, the
-- final composed decision, and short-lived capability tokens.

-- ---------------------------------------------------------------------------
-- Settings: enforce becomes representable, but only with an explicit approval
-- of the exact provider and model. (Part 5's CHECK forbade enforce outright.)
-- Whether that provider is actually *enforcement-grade* depends on the
-- tenant's environment and is decided in gateway.provider_enforcement_grade().
-- ---------------------------------------------------------------------------
alter table public.semantic_settings drop constraint semantic_settings_enforce_unavailable;

alter table public.semantic_settings
  add column enforcement_approved_provider text,
  add column enforcement_approved_model text,
  add column enforcement_approved_at timestamptz,
  add column enforcement_approved_by_principal_id uuid,
  -- Risk classes (low/medium/high) for which a healthy semantic verdict is
  -- REQUIRED before any allow. Empty = semantic evidence is optional everywhere.
  add column semantic_required_classes text[] not null default '{}',
  add column capability_ttl_seconds integer not null default 60;

alter table public.semantic_settings
  add constraint semantic_settings_required_classes_valid
    check (semantic_required_classes <@ array['low', 'medium', 'high']::text[]),
  add constraint semantic_settings_ttl_bounded check (capability_ttl_seconds between 5 and 900),
  add constraint semantic_settings_enforce_needs_approval check (
    mode <> 'enforce'
    or (enforcement_approved_at is not null
        and enforcement_approved_provider = provider
        and enforcement_approved_model = model)
  ),
  add constraint semantic_settings_approver_fk
    foreign key (enforcement_approved_by_principal_id, tenant_id) references public.principals (id, tenant_id);

-- ---------------------------------------------------------------------------
-- Gateway-attested semantic evaluations (shadow *and* enforce). Written only
-- by gateway.commit_authorization(), i.e. by a caller holding the gateway
-- credential — that is the attestation. Part 5's unattested table is left in
-- place, read-only, as the historical record.
-- ---------------------------------------------------------------------------
create table public.semantic_evaluations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  task_id     uuid not null,
  tool_request_id uuid not null,
  authorization_decision_id uuid not null,
  agent_id    uuid not null,
  mode        public.semantic_mode not null,
  -- Whether the provider was enforcement-grade *for this tenant at that time*.
  enforcement_grade boolean not null,
  attestation text not null default 'gateway_attested',
  evidence_schema_version integer not null default 1,
  provider    text not null check (char_length(btrim(provider)) between 1 and 100),
  model       text not null check (char_length(btrim(model)) between 1 and 200),
  model_version text not null check (char_length(btrim(model_version)) between 1 and 100),
  state       public.semantic_evidence_state not null,
  signals     jsonb,
  indicators  text[] not null default '{}',
  risk_level  public.semantic_risk_level not null,
  confidence  double precision not null check (confidence >= 0 and confidence <= 1),
  latency_ms  integer not null check (latency_ms >= 0 and latency_ms <= 600000),
  input_hash  text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  redaction_summary jsonb not null default '{"schemaVersion":1}'::jsonb check (pg_column_size(redaction_summary) <= 2048),
  error_category text check (error_category is null or error_category ~ '^[a-z_]{1,40}$'),
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  unique (authorization_decision_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (tool_request_id, tenant_id) references public.tool_requests (id, tenant_id),
  foreign key (authorization_decision_id, tenant_id) references public.authorization_decisions (id, tenant_id),
  foreign key (agent_id, tenant_id) references public.agents (id, tenant_id),
  constraint semantic_eval_mode check (mode in ('shadow', 'enforce')),
  constraint semantic_eval_attestation check (attestation = 'gateway_attested'),
  constraint semantic_eval_signals_iff_ok check ((state = 'ok') = (signals is not null)),
  constraint semantic_eval_unknown_when_not_ok check (state = 'ok' or risk_level = 'unknown'),
  constraint semantic_eval_indicators_bounded check (cardinality(indicators) <= 16)
);
create index semantic_evaluations_tenant_created_idx on public.semantic_evaluations (tenant_id, created_at desc);
create index semantic_evaluations_task_idx on public.semantic_evaluations (task_id, created_at);

-- ---------------------------------------------------------------------------
-- The final composed decision, stored separately from both inputs.
-- ---------------------------------------------------------------------------
create table public.final_decisions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  task_id     uuid not null,
  tool_request_id uuid not null,
  authorization_decision_id uuid not null,
  semantic_evaluation_id uuid,
  deterministic_outcome public.authorization_outcome not null,
  final_outcome public.authorization_outcome not null,
  semantic_mode public.semantic_mode not null,
  -- 'required' | 'optional' | 'not_applicable' (semantic not in play).
  semantic_policy text not null check (semantic_policy in ('required', 'optional', 'not_applicable')),
  risk_class  text not null check (risk_class in ('low', 'medium', 'high')),
  composition_reasons text[] not null default '{}',
  degraded    boolean not null default false,
  degraded_reason text check (degraded_reason is null or degraded_reason ~ '^[a-z_]{1,40}$'),
  narrowed    boolean not null,
  gateway_version text not null check (char_length(gateway_version) between 1 and 60),
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  unique (authorization_decision_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (tool_request_id, tenant_id) references public.tool_requests (id, tenant_id),
  foreign key (authorization_decision_id, tenant_id) references public.authorization_decisions (id, tenant_id),
  foreign key (semantic_evaluation_id, tenant_id) references public.semantic_evaluations (id, tenant_id),
  -- Monotonicity, enforced by the storage layer: composition can never be more
  -- permissive than the deterministic decision.
  constraint final_never_broader_than_deterministic
    check (gateway.outcome_rank(final_outcome) <= gateway.outcome_rank(deterministic_outcome)),
  constraint final_narrowed_flag_consistent check (narrowed = (final_outcome <> deterministic_outcome)),
  constraint final_shadow_is_never_narrowed check (semantic_mode <> 'shadow' or not narrowed),
  constraint final_off_is_never_narrowed check (semantic_mode <> 'off' or not narrowed)
);
create index final_decisions_tenant_created_idx on public.final_decisions (tenant_id, created_at desc);
create index final_decisions_task_idx on public.final_decisions (task_id, created_at);

-- ---------------------------------------------------------------------------
-- Capabilities (opaque hashed tokens). The plaintext exists only in the one
-- authorization response that issued it; only its SHA-256 is stored.
-- ---------------------------------------------------------------------------
create table public.capability_tokens (
  id          uuid primary key default gen_random_uuid(),          -- the jti
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  agent_id    uuid not null,
  task_id     uuid not null,
  credential_id uuid not null,
  contract_id uuid not null,
  contract_version integer not null check (contract_version > 0),
  authorization_decision_id uuid not null,
  final_decision_id uuid not null,
  budget_capability_id uuid not null,
  tool        text not null check (tool ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  operation   text not null check (char_length(btrim(operation)) between 1 and 100),
  resource    text check (resource is null or char_length(resource) <= 200),
  -- The exact constraints the final decision applied ({"schemaVersion":1,"items":[...]}).
  resource_constraints jsonb not null check (authz.has_allowed_schema_version(resource_constraints, array[1])),
  -- SHA-256 of the canonical arguments the decision was made for. Consumption
  -- must present arguments hashing to exactly this.
  arguments_hash text not null check (arguments_hash ~ '^[0-9a-f]{64}$'),
  max_uses    integer not null check (max_uses between 1 and 5),
  uses        integer not null default 0 check (uses >= 0),
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Token format / hashing scheme version, for future rotation.
  format_version integer not null default 1 check (format_version = 1),
  status      text not null default 'active' check (status in ('active', 'consumed', 'revoked')),
  revoked_at  timestamptz,
  revoked_by  text check (revoked_by in ('agent', 'admin', 'system')),
  revoked_by_principal_id uuid,
  revocation_reason text check (revocation_reason is null or char_length(revocation_reason) <= 500),
  unique (id, tenant_id),
  foreign key (agent_id, tenant_id) references public.agents (id, tenant_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (credential_id, tenant_id) references public.agent_credentials (id, tenant_id),
  foreign key (contract_id, tenant_id) references public.task_authority_contracts (id, tenant_id),
  foreign key (authorization_decision_id, tenant_id) references public.authorization_decisions (id, tenant_id),
  foreign key (final_decision_id, tenant_id) references public.final_decisions (id, tenant_id),
  foreign key (budget_capability_id, tenant_id) references public.capabilities (id, tenant_id),
  foreign key (revoked_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  constraint capability_uses_within_max check (uses <= max_uses),
  constraint capability_short_lived check (expires_at > issued_at and expires_at - issued_at <= interval '15 minutes'),
  constraint capability_revocation_consistent check (
    (status = 'revoked') = (revoked_at is not null and revoked_by is not null and revocation_reason is not null)
  ),
  constraint capability_consumed_means_exhausted check (status <> 'consumed' or uses = max_uses)
);
create index capability_tokens_tenant_issued_idx on public.capability_tokens (tenant_id, issued_at desc);
create index capability_tokens_task_idx on public.capability_tokens (task_id);
create index capability_tokens_decision_idx on public.capability_tokens (authorization_decision_id);

comment on table public.capability_tokens is
  'One row per issued capability. Opaque token: the plaintext is a 256-bit '
  'random value shown once; only its SHA-256 is stored, so a database read '
  'cannot yield a usable token. Revocation and single-use are database state, '
  'which is why a stateless signed token was rejected (see docs/gateway/CAPABILITIES.md).';

-- Only uses/status/revocation fields may ever change, and only forward.
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
revoke all on function gateway.enforce_capability_immutable() from public;

create trigger capability_tokens_guard
  before update or delete on public.capability_tokens
  for each row execute function gateway.enforce_capability_immutable();

-- Every consumption attempt on a known capability, accepted or not.
create table public.capability_consumptions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  capability_id uuid not null,
  agent_id    uuid not null,
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 1 and 200),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result      text not null check (result in ('accepted', 'rejected')),
  reason_code text not null check (reason_code ~ '^[A-Z_]{1,60}$'),
  use_number  integer check (use_number is null or use_number > 0),
  -- Part 6 executes nothing: every consumption is a simulation. The CHECK
  -- keeps a future connector from silently reusing this table as if real.
  simulated   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  unique (capability_id, idempotency_key),
  foreign key (capability_id, tenant_id) references public.capability_tokens (id, tenant_id),
  foreign key (agent_id, tenant_id) references public.agents (id, tenant_id),
  constraint consumption_simulated_only check (simulated = true),
  constraint consumption_accepted_has_use check ((result = 'accepted') = (use_number is not null))
);
create index capability_consumptions_capability_idx on public.capability_consumptions (capability_id, created_at);

-- Append-only evidence tables.
create trigger semantic_evaluations_append_only before update or delete on public.semantic_evaluations
  for each row execute function authz.forbid_update_delete();
create trigger final_decisions_append_only before update or delete on public.final_decisions
  for each row execute function authz.forbid_update_delete();
create trigger capability_consumptions_append_only before update or delete on public.capability_consumptions
  for each row execute function authz.forbid_update_delete();

-- RLS: members read within their tenant; nothing is client-writable.
alter table public.semantic_evaluations enable row level security;
alter table public.final_decisions enable row level security;
alter table public.capability_tokens enable row level security;
alter table public.capability_consumptions enable row level security;

revoke all on public.semantic_evaluations, public.final_decisions, public.capability_tokens,
  public.capability_consumptions from public, anon, authenticated;
grant select on public.semantic_evaluations, public.final_decisions, public.capability_consumptions to authenticated;
-- The token hash is never readable, even by an admin: column-level grant.
grant select (id, tenant_id, agent_id, task_id, credential_id, contract_id, contract_version,
  authorization_decision_id, final_decision_id, budget_capability_id, tool, operation, resource,
  resource_constraints, arguments_hash, max_uses, uses, issued_at, expires_at, format_version, status,
  revoked_at, revoked_by, revoked_by_principal_id, revocation_reason)
  on public.capability_tokens to authenticated;

create policy "semantic_evaluations_select_within_tenant" on public.semantic_evaluations
  for select to authenticated using (authz.is_member_of(tenant_id));
create policy "final_decisions_select_within_tenant" on public.final_decisions
  for select to authenticated using (authz.is_member_of(tenant_id));
create policy "capability_tokens_select_within_tenant" on public.capability_tokens
  for select to authenticated using (authz.is_member_of(tenant_id));
create policy "capability_consumptions_select_within_tenant" on public.capability_consumptions
  for select to authenticated using (authz.is_member_of(tenant_id));
