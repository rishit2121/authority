-- Part 3A: contract_compilations — audit/reproducibility evidence, never
-- an authenticity signature.
--
-- Records only compilation attempts that successfully produced a proposed
-- contract, inserted atomically by propose_task_contract() in the same
-- transaction as the contract row itself. A failed validation/solver/
-- verification attempt is surfaced to the browser transiently, in the
-- server action's response, and is never persisted anywhere — this is a
-- deliberate narrowing (see the design review), not an oversight: it
-- removes the entire "client can write unbounded audit rows" surface by
-- construction, since no RPC exists that a client could call to write a
-- failure record at all. If failure-attempt auditing is wanted later, it
-- should be its own narrow, rate/size-limited RPC in a dedicated future
-- part, not folded in here.
--
-- References an immutable plan *version* (plan_id), never a mutable row —
-- plans/plan_nodes are themselves append-only as of the previous migration,
-- so plan_id alone is already "a reference to an immutable version," not
-- just a reference to a row that happens not to have changed yet.
--
-- A row here is never proof of authenticity and never grants tool access,
-- capability issuance, or activation — see the module doc in
-- contract-verifier.ts and contract-compiler.ts for what these hashes do
-- and do not prove.

create table public.contract_compilations (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  task_id        uuid not null,
  plan_id        uuid not null,
  contract_id    uuid not null,
  registry_version text not null check (char_length(registry_version) between 1 and 40),
  compiler_version  text not null check (char_length(compiler_version) between 1 and 60),
  input_hash     text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  output_hash    text not null check (output_hash ~ '^[0-9a-f]{64}$'),
  -- {"schemaVersion":1,"ok":bool,"checks":[{code,passed,detail}]}
  verifier_result jsonb not null check (authz.has_allowed_schema_version(verifier_result, array[1])),
  -- {"schemaVersion":1,"excessOperationCount":n,"totalRiskCost":n,"totalResourceBreadth":n,"permissionCount":n,"selectedPermissionIds":[...]}
  objective_trace jsonb not null check (authz.has_allowed_schema_version(objective_trace, array[1])),
  created_at     timestamptz not null default now(),
  unique (id, tenant_id),
  check (pg_column_size(verifier_result) <= 16384),
  check (pg_column_size(objective_trace) <= 8192),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (plan_id, tenant_id) references public.plans (id, tenant_id),
  foreign key (contract_id, tenant_id) references public.task_authority_contracts (id, tenant_id)
);

comment on table public.contract_compilations is
  'Audit/reproducibility trail for successful contract compilations only. '
  'Never proof of authenticity; never grants tool access, capability '
  'issuance or activation. See contract-verifier.ts / contract-compiler.ts.';

create index contract_compilations_task_id_idx on public.contract_compilations (task_id);

alter table public.contract_compilations enable row level security;
revoke all on table public.contract_compilations from public, anon;
grant select on table public.contract_compilations to authenticated;

create policy "contract_compilations_select_within_tenant"
  on public.contract_compilations for select to authenticated
  using (authz.is_member_of(tenant_id));

create trigger contract_compilations_append_only
  before update or delete on public.contract_compilations
  for each row execute function authz.forbid_update_delete();
