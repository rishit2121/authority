-- Part 2B.1: task authority contracts, plans, plan nodes.

create table public.task_authority_contracts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  task_id     uuid not null,
  version     integer not null default 1 check (version > 0),
  spec_version text not null check (char_length(btrim(spec_version)) between 1 and 40),
  -- {"schemaVersion":1,"items":[{tool, constraints:[{key,equals|matches}], maxInvocations?}]}
  allowed_actions jsonb not null
    check (authz.has_allowed_schema_version(allowed_actions, array[1])),
  -- Flat array of glob strings — no object shape, so no version tag needed.
  forbidden_resources text[] not null default '{}',
  -- {"schemaVersion":1,"maxToolInvocations":n,"expiresInSeconds":n}
  ephemeral_limits jsonb not null
    check (authz.has_allowed_schema_version(ephemeral_limits, array[1])),
  -- Database-only: what evidence the contract was derived from. Dropped by
  -- the domain mapper — the domain contract is the resulting authority
  -- boundary, not its derivation trail.
  source_evidence_metadata jsonb not null default '{"schemaVersion": 1}'::jsonb
    check (authz.has_allowed_schema_version(source_evidence_metadata, array[1])),
  -- Database-only lifecycle status backing the immutability rule below. The
  -- domain has no such field: a TaskAuthorityContract *is* the active
  -- authority boundary at the instant it's read.
  contract_status public.contract_status not null default 'active',
  created_by  uuid references auth.users (id) on delete set null,
  demo_key    text,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  unique (task_id, version),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id)
);

comment on table public.task_authority_contracts is
  'The maximum authority a task may ever receive. Immutable once '
  'contract_status = active (enforced by trigger in a later migration) — a '
  'change creates a new (task_id, version) row, never an edit of this one.';

create unique index contracts_tenant_demo_key_idx
  on public.task_authority_contracts (tenant_id, demo_key) where demo_key is not null;

create table public.plans (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  task_id     uuid not null,
  -- Database-only versioning/provenance. The domain's Plan is "the plan as
  -- currently proposed"; superseding it is a product-level concept the
  -- domain doesn't yet need to represent.
  version     integer not null default 1 check (version > 0),
  status      public.plan_status not null default 'proposed',
  submitted_by uuid references auth.users (id) on delete set null,
  model_metadata jsonb default '{"schemaVersion": 1}'::jsonb
    check (model_metadata is null or authz.has_allowed_schema_version(model_metadata, array[1])),
  proposed_at timestamptz not null default now(),
  demo_key    text,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  unique (task_id, version),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id)
);

comment on table public.plans is
  'The agent''s proposed execution plan. Untrusted until each node is '
  'evaluated — Authority treats this as an assertion of intent, never an '
  'instruction.';

create unique index plans_tenant_demo_key_idx
  on public.plans (tenant_id, demo_key) where demo_key is not null;

create table public.plan_nodes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  plan_id     uuid not null,
  -- Stable key for referencing a node across plan versions. Database-only:
  -- the domain uses the row's own `id` as its identifier.
  node_key    text not null check (char_length(btrim(node_key)) between 1 and 100),
  sequence_no integer not null check (sequence_no >= 0),
  tool        text not null check (tool ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  -- Normalized query/security fields, kept first-class per the schema rules
  -- rather than buried in JSONB. Database-only — dropped by the mapper.
  operation   text not null check (char_length(btrim(operation)) between 1 and 100),
  resource    text,
  -- {"schemaVersion":1,"values":{...flat record of primitives...}}
  normalized_arguments jsonb not null default '{"schemaVersion": 1, "values": {}}'::jsonb
    check (authz.has_allowed_schema_version(normalized_arguments, array[1])),
  dependencies uuid[] not null default '{}',
  expected_effect text,
  execution_order integer,
  status      public.plan_node_status not null default 'proposed',
  rationale   text,
  demo_key    text,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  unique (plan_id, sequence_no),
  foreign key (plan_id, tenant_id) references public.plans (id, tenant_id)
);

comment on table public.plan_nodes is
  'One step of a proposed plan. operation/resource/dependencies/'
  'expected_effect/execution_order/node_key are database-only normalized '
  'query fields — the domain PlanNode is {id, sequence, tool, arguments, '
  'status, rationale}.';

create unique index plan_nodes_tenant_demo_key_idx
  on public.plan_nodes (tenant_id, demo_key) where demo_key is not null;
