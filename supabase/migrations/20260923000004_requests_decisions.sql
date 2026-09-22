-- Part 2B.1: tool requests, semantic decisions, authorization decisions.

create table public.tool_requests (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  task_id     uuid not null,
  plan_id     uuid,
  plan_node_id uuid,
  agent_id    uuid not null,
  tool        text not null check (tool ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  operation   text not null check (char_length(btrim(operation)) between 1 and 100),
  resource    text,
  -- {"schemaVersion":1,"values":{...flat record of primitives...}}
  normalized_arguments jsonb not null default '{"schemaVersion": 1, "values": {}}'::jsonb
    check (authz.has_allowed_schema_version(normalized_arguments, array[1])),
  expected_effect text,
  destination_metadata jsonb default '{"schemaVersion": 1}'::jsonb
    check (destination_metadata is null or authz.has_allowed_schema_version(destination_metadata, array[1])),
  provenance  text not null default 'agent_proposed',
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 1 and 200),
  demo_key    text,
  requested_at timestamptz not null default now(),
  unique (id, tenant_id),
  -- Required uniqueness boundary: a retried request with the same key inside
  -- the same task must not be double-counted.
  unique (tenant_id, task_id, idempotency_key),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (plan_id, tenant_id) references public.plans (id, tenant_id),
  foreign key (plan_node_id, tenant_id) references public.plan_nodes (id, tenant_id),
  foreign key (agent_id, tenant_id) references public.agents (id, tenant_id)
);

comment on table public.tool_requests is
  'One runtime request from the agent to invoke a tool — the unit the '
  'evaluator decides on. operation/resource/expected_effect/destination_'
  'metadata/provenance are database-only; the domain ToolRequest is '
  '{id, tenantId, taskId, agentId, tool, arguments, planNodeId?, requestedAt}.';

create unique index tool_requests_tenant_demo_key_idx
  on public.tool_requests (tenant_id, demo_key) where demo_key is not null;

create table public.semantic_decisions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  task_id     uuid not null,
  tool_request_id uuid not null,
  provider    text not null check (char_length(btrim(provider)) between 1 and 100),
  model       text not null check (char_length(btrim(model)) between 1 and 200),
  model_version text not null check (char_length(btrim(model_version)) between 1 and 100),
  -- {"schemaVersion":1,"taskRelevance":0..1,"resourceRelevance":0..1,
  --  "scopeExpansion":0..1,"externalDisclosure":0..1,"planConsistency":0..1,
  --  "semanticRisk":0..1}
  probabilities jsonb not null
    check (authz.has_allowed_schema_version(probabilities, array[1])),
  confidence  double precision not null check (confidence >= 0 and confidence <= 1),
  latency_ms  integer not null check (latency_ms >= 0),
  state       public.semantic_decision_state not null,
  -- Short categorical field for querying/alerting. Database-only; the domain
  -- carries only the free-text errorMessage below.
  error_category text,
  error_message text,
  demo_key    text,
  evaluated_at timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (tool_request_id, tenant_id) references public.tool_requests (id, tenant_id)
);

comment on table public.semantic_decisions is
  'Structured evidence from a semantic provider (Jev in production; mock '
  'demo data only in this phase). Advisory input to authorization_decisions, '
  'never itself a decision. error_category is database-only.';

create unique index semantic_decisions_tenant_demo_key_idx
  on public.semantic_decisions (tenant_id, demo_key) where demo_key is not null;

create table public.authorization_decisions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  task_id     uuid not null,
  tool_request_id uuid not null,
  contract_id uuid not null,
  -- Cross-check convenience, redundant with contract_id's own version.
  -- Database-only; dropped by the mapper.
  contract_version integer not null check (contract_version > 0),
  semantic_decision_id uuid,
  outcome     public.authorization_outcome not null,
  -- {"schemaVersion":1,"items":[{code,detail,source}]}
  reason_codes jsonb not null
    check (authz.has_allowed_schema_version(reason_codes, array[1])),
  -- Database-only: which deterministic policy rows (if any) this cross-
  -- referenced. Dropped by the mapper; the domain's reasons already carry
  -- the human-readable equivalent.
  matched_policy_ids uuid[] not null default '{}',
  -- {"schemaVersion":1,"items":[{key,equals|matches}]}
  applied_constraints jsonb not null default '{"schemaVersion": 1, "items": []}'::jsonb
    check (authz.has_allowed_schema_version(applied_constraints, array[1])),
  evidence_references jsonb default '{"schemaVersion": 1}'::jsonb
    check (evidence_references is null or authz.has_allowed_schema_version(evidence_references, array[1])),
  latency_ms  integer not null check (latency_ms >= 0),
  demo_key    text,
  created_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (tool_request_id, tenant_id) references public.tool_requests (id, tenant_id),
  foreign key (contract_id, tenant_id) references public.task_authority_contracts (id, tenant_id),
  foreign key (semantic_decision_id, tenant_id) references public.semantic_decisions (id, tenant_id)
);

comment on table public.authorization_decisions is
  'Append-only. No authenticated role holds UPDATE or DELETE on this table — '
  'see 20260923000008_product_rls.sql. outcome maps to the domain''s '
  '`status` field; created_at maps to `decidedAt`.';

create unique index authorization_decisions_tenant_demo_key_idx
  on public.authorization_decisions (tenant_id, demo_key) where demo_key is not null;
