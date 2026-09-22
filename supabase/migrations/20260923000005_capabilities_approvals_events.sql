-- Part 2B.1: capabilities, approvals, execution events.

create table public.capabilities (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  task_id     uuid not null,
  authorization_decision_id uuid not null,
  -- Database-only: useful for "active capabilities per agent" queries. The
  -- domain Capability has no agentId field of its own.
  agent_id    uuid not null,
  tool        text not null check (tool ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  -- {"schemaVersion":1,"items":[{key,equals|matches}]} — maps to the
  -- domain's `constraints` field.
  resource_constraints jsonb not null default '{"schemaVersion": 1, "items": []}'::jsonb
    check (authz.has_allowed_schema_version(resource_constraints, array[1])),
  -- Database-only further narrowing, separate from resource_constraints.
  -- The domain does not distinguish resource- from argument-level
  -- constraints; both collapse into one `constraints` array on read.
  argument_constraints jsonb default '{"schemaVersion": 1, "items": []}'::jsonb
    check (argument_constraints is null or authz.has_allowed_schema_version(argument_constraints, array[1])),
  status      public.capability_status not null default 'active',
  max_invocations integer not null check (max_invocations > 0),
  consumed_uses integer not null default 0 check (consumed_uses >= 0),
  issued_at   timestamptz not null default now(),
  -- Mandatory, exactly as the domain requires: standing access has no
  -- representation in this schema either.
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  revocation_reason text,
  demo_key    text,
  unique (id, tenant_id),
  check (consumed_uses <= max_invocations),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (authorization_decision_id, tenant_id)
    references public.authorization_decisions (id, tenant_id),
  foreign key (agent_id, tenant_id) references public.agents (id, tenant_id)
);

comment on table public.capabilities is
  'A temporary, constrained permission. Read-only to every authenticated '
  'role in this phase — no capability service exists yet, so the only way a '
  'row is created is the demo installer, and the only way one is revoked is '
  'the terminate_task() RPC. Nothing can mint a capability by inserting a '
  'row directly. resource_constraints maps to the domain''s `constraints`.';

create unique index capabilities_tenant_demo_key_idx
  on public.capabilities (tenant_id, demo_key) where demo_key is not null;

create table public.approvals (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  task_id     uuid not null,
  authorization_decision_id uuid not null,
  requested_authority_delta jsonb default '{"schemaVersion": 1}'::jsonb
    check (requested_authority_delta is null
      or authz.has_allowed_schema_version(requested_authority_delta, array[1])),
  -- The app user or process that raised the approval. Distinct from
  -- requested_from_principal_id below (who it's routed to). Database-only.
  requested_by uuid references auth.users (id) on delete set null,
  requested_from_principal_id uuid not null,
  -- Pre-resolution routing, separate from the final responder. Database-
  -- only: the domain doesn't represent an in-flight "assigned to" state
  -- distinct from who ultimately responded.
  assigned_approver_principal_id uuid,
  status      public.approval_status not null default 'pending',
  summary     text not null check (char_length(btrim(summary)) between 1 and 2000),
  decision_reason text,
  requested_at timestamptz not null default now(),
  decided_at  timestamptz,
  responded_by_principal_id uuid,
  demo_key    text,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (authorization_decision_id, tenant_id)
    references public.authorization_decisions (id, tenant_id),
  foreign key (requested_from_principal_id, tenant_id) references public.principals (id, tenant_id),
  foreign key (assigned_approver_principal_id, tenant_id) references public.principals (id, tenant_id),
  foreign key (responded_by_principal_id, tenant_id) references public.principals (id, tenant_id)
);

comment on table public.approvals is
  'A human sign-off gate. decision_reason maps to the domain''s '
  '`responseNote`; decided_at maps to `respondedAt`. requested_by and '
  'assigned_approver_principal_id are database-only.';

create unique index approvals_tenant_demo_key_idx
  on public.approvals (tenant_id, demo_key) where demo_key is not null;

create table public.execution_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  task_id     uuid not null,
  capability_id uuid,
  -- Database-only: the domain ExecutionEvent has no toolRequestId field.
  tool_request_id uuid,
  decision_id uuid,
  event_type  public.execution_event_type not null,
  result_status public.execution_outcome not null,
  summary     text not null check (char_length(btrim(summary)) between 1 and 2000),
  detail      text,
  normalized_effect_metadata jsonb default '{"schemaVersion": 1}'::jsonb
    check (normalized_effect_metadata is null
      or authz.has_allowed_schema_version(normalized_effect_metadata, array[1])),
  -- Holds a content hash rather than the full payload for anything large or
  -- sensitive — see the "audit integrity" note in this migration's comment
  -- below. Not populated by the demo installer, which has nothing sensitive
  -- to hash, but the column and its shape exist for the real pipeline.
  receipt_metadata jsonb default '{"schemaVersion": 1}'::jsonb
    check (receipt_metadata is null or authz.has_allowed_schema_version(receipt_metadata, array[1])),
  demo_key    text,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (capability_id, tenant_id) references public.capabilities (id, tenant_id),
  foreign key (tool_request_id, tenant_id) references public.tool_requests (id, tenant_id),
  foreign key (decision_id, tenant_id) references public.authorization_decisions (id, tenant_id)
);

comment on table public.execution_events is
  'Append-only audit trail. No authenticated role holds UPDATE or DELETE — '
  'see 20260923000008_product_rls.sql. event_type maps to the domain''s '
  '`type`; result_status maps to `outcome`; created_at maps to `occurredAt`. '
  'Raw credentials, access tokens, email bodies, repository secrets and '
  'model chain-of-thought are never stored here — receipt_metadata carries a '
  'hash where full content matters, never the content itself.';

create unique index execution_events_tenant_demo_key_idx
  on public.execution_events (tenant_id, demo_key) where demo_key is not null;
