-- Part 4: extends the Part 2B.1 request/decision/capability tables for real
-- runtime consumption — until now the demo installer was the only writer to
-- any of them (see capabilities' and authorization_decisions' own comments).

alter table public.capabilities
  add column contract_id uuid,
  add constraint capabilities_contract_fk
    foreign key (contract_id, tenant_id) references public.task_authority_contracts (id, tenant_id);

comment on column public.capabilities.contract_id is
  'Null for pre-Part-4 demo-installed rows, which had no contract concept. '
  'Every capability authorize_tool_call() issues sets this, and one row is '
  'reused across every call for that (contract, tool) pair rather than '
  'minting a new one per call — see capabilities_one_per_contract_tool.';

-- One capability row per (contract, tool): authorize_tool_call() locates
-- and reuses this single row on every call for that tool under that
-- contract, atomically incrementing consumed_uses, rather than ever
-- inserting a second row for the same pair.
create unique index capabilities_one_per_contract_tool
  on public.capabilities (contract_id, tool) where contract_id is not null;

alter table public.authorization_decisions
  alter column contract_id drop not null,
  alter column contract_version drop not null,
  add column capability_id uuid,
  add constraint authorization_decisions_capability_fk
    foreign key (capability_id, tenant_id) references public.capabilities (id, tenant_id);

comment on column public.authorization_decisions.contract_id is
  'Nullable as of Part 4: a runtime call made before any contract was ever '
  'proposed for the task has nothing to reference and is always a deny — '
  'see authorization_decisions_contract_required_unless_denied.';

alter table public.authorization_decisions
  add constraint authorization_decisions_contract_required_unless_denied
    check (contract_id is not null or outcome = 'deny'),
  add constraint authorization_decisions_capability_only_when_permitted
    check (capability_id is null or outcome in ('allow', 'allow_constrained'));

alter table public.tool_requests
  add column request_hash text check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$');

comment on column public.tool_requests.request_hash is
  'SHA-256 of the canonical request payload (tool, operation, resource, '
  'arguments, plan_node_id), computed by authorize_tool_call() itself, '
  'never supplied by the caller. A retried idempotency key must reproduce '
  'the same hash or the retry is rejected (23505) rather than silently '
  'replayed against different content.';
