-- Generic connector framework: the provider-neutral counterpart to Part 7's
-- GitHub-specific reserve -> dispatch -> settle -> receipt -> reconcile
-- pipeline (20260930000003_two_phase_capabilities.sql). GitHub's own tables
-- and functions are untouched by this migration; new connectors (Custom
-- API, Stripe, Gmail, Slack, PostgreSQL) use the tables and functions below
-- instead, reached through `AuthorityConnector` (src/lib/connectors/types.ts)
-- and the generic `POST /api/v1/execute` route rather than a GitHub-shaped
-- one-route-per-connector pattern.
--
-- Deliberately duplicated rather than generalizing GitHub's own functions in
-- place: those functions and their 134+108 pgTAP assertions
-- (19_gateway_enforcement.sql, 20_github_connector.sql) are the one thing
-- this roadmap is explicitly told to preserve unmodified. A new, parallel
-- set of tables/functions costs some duplication; it costs zero regression
-- risk to the proven path.
--
-- What's simpler here than GitHub's own version, deliberately:
--   - No per-task "repository binding" equivalent. GitHub binds one task to
--     one repository as defense in depth beyond the capability's own
--     resource match, because a GitHub capability's `resource` is a loosely
--     structured "owner/repo#991" string. Every other connector's capability
--     already carries an exact resource/constraint set checked by
--     `gateway.constraints_satisfied()` (unchanged, reused below) — that
--     check alone is the resource boundary; no connector-specific binding
--     table is required for a first version. A connector that later needs
--     its own extra per-task binding (the way GitHub does) can add one
--     without touching this schema.
--   - No hand-synced "is this tool connector-executable" allowlist. A
--     capability for `stripe.retrieve_payment` could only have been issued
--     because that operation was already in the (possibly tenant-extended)
--     registry the deterministic pipeline compiled against — the
--     capability's existence is the proof. Reservation only additionally
--     requires an *active* connection for the tool's provider to exist.

-- ---------------------------------------------------------------------------
-- Tenant-configured instance of a connector ("our Stripe test account", one
-- of a tenant's Custom API connections). The generic counterpart to
-- `github_installations`.
-- ---------------------------------------------------------------------------
create type public.connector_connection_status as enum (
  'active', 'suspended', 'needs_attention', 'disconnected'
);

create table public.connector_connections (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  -- The tool-name provider prefix this connection answers for, e.g. "stripe",
  -- "custom_a1b2c3d4". One active connection per (tenant, connector_id).
  connector_id text not null check (connector_id ~ '^[a-z0-9_]{1,64}$'),
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  environment public.tenant_environment not null default 'development',
  status      public.connector_connection_status not null default 'active',
  health_reasons text[] not null default '{}',
  last_verified_at timestamptz,
  -- Bumped on any configuration change (credential rotation, auth type
  -- change, etc.) — pinned onto every capability issued against this
  -- connection so a config change can never silently widen or narrow
  -- authority already granted under the prior version.
  config_version integer not null default 1 check (config_version > 0),
  connected_by_principal_id uuid,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  disconnected_by_principal_id uuid,
  demo_key    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (connected_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  foreign key (disconnected_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  constraint connector_connection_disconnected_has_timestamp
    check ((status = 'disconnected') = (disconnected_at is not null))
);
-- One non-disconnected connection per (tenant, connector) at a time — a
-- second connection replacing the first must disconnect it first, mirroring
-- github_installations' equivalent partial unique index.
create unique index connector_connections_one_active_per_connector
  on public.connector_connections (tenant_id, connector_id)
  where status <> 'disconnected';
create index connector_connections_tenant_idx on public.connector_connections (tenant_id, created_at desc);

create trigger connector_connections_touch_updated_at
  before update on public.connector_connections
  for each row execute function authz.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The generic two-phase reservation — same shape and lifecycle as
-- `capability_reservations`, with a connection instead of a GitHub
-- installation/repository.
-- ---------------------------------------------------------------------------
create table public.connector_reservations (
  id          uuid primary key default gen_random_uuid(),   -- the execution id
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  capability_id uuid not null,
  agent_id    uuid not null,
  task_id     uuid not null,
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 1 and 200),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  tool        text not null check (tool ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  operation   text not null,
  resource    text check (resource is null or char_length(resource) <= 200),
  connector_id text not null check (connector_id ~ '^[a-z0-9_]{1,64}$'),
  connection_id uuid not null,
  connection_config_version integer not null,
  status      text not null default 'reserved'
    check (status in ('reserved', 'consumed', 'released', 'failed', 'indeterminate')),
  execution_mode text not null check (execution_mode in ('mock', 'live')),
  reserved_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  dispatched_at timestamptz,
  finished_at timestamptz,
  reason_code text check (reason_code is null or reason_code ~ '^[A-Z_]{1,60}$'),
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
  foreign key (connection_id, tenant_id) references public.connector_connections (id, tenant_id),
  foreign key (resolved_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  constraint connector_reservation_lease_after_reserved
    check (lease_expires_at > reserved_at and lease_expires_at - reserved_at <= interval '5 minutes'),
  constraint connector_reservation_terminal_has_finish check ((status = 'reserved') = (finished_at is null)),
  constraint connector_reservation_resolution_only_indeterminate
    check (resolved_outcome is null or status = 'indeterminate')
);
create index connector_reservations_capability_idx on public.connector_reservations (capability_id, created_at);
create index connector_reservations_open_lease_idx on public.connector_reservations (lease_expires_at) where status = 'reserved';
create index connector_reservations_task_idx on public.connector_reservations (task_id, created_at);

create or replace function gateway.enforce_connector_reservation_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('authority.allow_demo_purge', true) = 'on' then return old; end if;
    raise exception 'connector reservations cannot be deleted' using errcode = '23514';
  end if;
  if (new.id, new.tenant_id, new.capability_id, new.agent_id, new.task_id, new.idempotency_key, new.request_hash,
      new.tool, new.operation, new.resource, new.connector_id, new.connection_id, new.connection_config_version,
      new.execution_mode, new.reserved_at, new.lease_expires_at)
     is distinct from
     (old.id, old.tenant_id, old.capability_id, old.agent_id, old.task_id, old.idempotency_key, old.request_hash,
      old.tool, old.operation, old.resource, old.connector_id, old.connection_id, old.connection_config_version,
      old.execution_mode, old.reserved_at, old.lease_expires_at) then
    raise exception 'a reservation''s binding is immutable' using errcode = '23514';
  end if;
  if old.status <> 'reserved' then
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
revoke all on function gateway.enforce_connector_reservation_transition() from public;
create trigger connector_reservations_guard
  before update or delete on public.connector_reservations
  for each row execute function gateway.enforce_connector_reservation_transition();

-- ---------------------------------------------------------------------------
-- Receipts: evidence, not authority. Append-only, tenant-isolated.
-- ---------------------------------------------------------------------------
create table public.connector_execution_receipts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  execution_id uuid not null unique,
  task_id     uuid not null,
  agent_id    uuid not null,
  capability_id uuid not null,
  authorization_decision_id uuid not null,
  connector_id text not null check (connector_id ~ '^[a-z0-9_]{1,64}$'),
  connection_id uuid,
  tool        text not null check (tool ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  operation   text not null,
  resource    text check (resource is null or char_length(resource) <= 200),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  execution_mode text not null check (execution_mode in ('mock', 'live')),
  result_category text not null
    check (result_category in ('succeeded', 'succeeded_noop', 'failed', 'indeterminate', 'released')),
  provider_request_id text check (provider_request_id is null or char_length(provider_request_id) <= 200),
  http_status_class smallint check (http_status_class is null or http_status_class between 1 and 5),
  -- Identifiers only, capped — never full provider objects.
  resource_ids jsonb not null default '{"schemaVersion":1}'::jsonb
    check (authz.has_allowed_schema_version(resource_ids, array[1]) and pg_column_size(resource_ids) <= 2048),
  started_at  timestamptz,
  finished_at timestamptz not null default now(),
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
  foreign key (connection_id, tenant_id) references public.connector_connections (id, tenant_id),
  constraint connector_receipt_result_has_reason
    check (result_category in ('succeeded', 'succeeded_noop') or reason_code is not null),
  constraint connector_receipt_finish_after_start check (started_at is null or finished_at >= started_at)
);
create index connector_execution_receipts_task_idx on public.connector_execution_receipts (task_id, created_at);
create index connector_execution_receipts_tenant_idx on public.connector_execution_receipts (tenant_id, created_at desc);
create trigger connector_execution_receipts_append_only
  before update or delete on public.connector_execution_receipts
  for each row execute function authz.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- RLS: members read within their tenant; nothing here is client-writable
-- directly — all writes go through the gateway/admin RPCs below.
-- ---------------------------------------------------------------------------
alter table public.connector_connections enable row level security;
alter table public.connector_reservations enable row level security;
alter table public.connector_execution_receipts enable row level security;

revoke all on public.connector_connections, public.connector_reservations, public.connector_execution_receipts
  from public, anon, authenticated;
grant select on public.connector_connections, public.connector_reservations, public.connector_execution_receipts
  to authenticated;

create policy "connector_connections_select_within_tenant" on public.connector_connections
  for select to authenticated using (authz.is_member_of(tenant_id));
create policy "connector_reservations_select_within_tenant" on public.connector_reservations
  for select to authenticated using (authz.is_member_of(tenant_id));
create policy "connector_execution_receipts_select_within_tenant" on public.connector_execution_receipts
  for select to authenticated using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- Connection lifecycle admin RPCs — same shape as GitHub's install/disconnect
-- functions (gateway.github_begin_install / github_disconnect): explicit
-- p_tenant_id/p_user_id because these run over the gateway's own pooled
-- connection, not the caller's own Supabase session.
-- ---------------------------------------------------------------------------
create or replace function gateway.create_connector_connection(
  p_tenant_id uuid, p_user_id uuid, p_connector_id text, p_name text, p_environment public.tenant_environment
)
returns table (cc_status text, cc_connection_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_principal uuid;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'admin') then
    return query select 'forbidden'::text, null::uuid; return;
  end if;
  if p_connector_id is null or p_connector_id !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'connector id must be lowercase alphanumeric/underscore, 1-64 chars' using errcode = '22023';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 200 then
    raise exception 'name must be 1-200 characters' using errcode = '22023';
  end if;
  v_principal := gateway.actor_principal(p_tenant_id, p_user_id);
  insert into public.connector_connections (tenant_id, connector_id, name, environment, connected_by_principal_id)
  values (p_tenant_id, p_connector_id, btrim(p_name), coalesce(p_environment, 'development'), v_principal)
  returning id into v_id;
  return query select 'ok'::text, v_id;
exception
  when unique_violation then
    return query select 'already_connected'::text, null::uuid;
end;
$fn$;
revoke all on function gateway.create_connector_connection(uuid, uuid, text, text, public.tenant_environment) from public;
grant execute on function gateway.create_connector_connection(uuid, uuid, text, text, public.tenant_environment) to authority_gateway;

-- Recompute health from the connector's own verifyInstallation() result,
-- supplied by the caller (TypeScript owns talking to the provider; this just
-- persists the outcome) — same division of labor as github_update_health.
create or replace function gateway.update_connector_connection_health(
  p_tenant_id uuid, p_connection_id uuid, p_status public.connector_connection_status, p_reasons text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.connector_connections
    set status = p_status, health_reasons = coalesce(p_reasons, '{}'), last_verified_at = now()
    where id = p_connection_id and tenant_id = p_tenant_id and status <> 'disconnected';
  if not found then return 'not_found'; end if;
  return 'ok';
end;
$fn$;
revoke all on function gateway.update_connector_connection_health(uuid, uuid, public.connector_connection_status, text[]) from public;
grant execute on function gateway.update_connector_connection_health(uuid, uuid, public.connector_connection_status, text[]) to authority_gateway;

-- Disconnect: blocks new authorization, revokes every active capability for
-- this connector's tools, preserves all evidence — same guarantees as
-- gateway.github_disconnect.
create or replace function gateway.disconnect_connector_connection(
  p_tenant_id uuid, p_user_id uuid, p_connection_id uuid
)
returns table (dc_status text, dc_revoked_capabilities integer)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_connector_id text;
  v_principal uuid;
  v_revoked integer;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'admin') then
    return query select 'forbidden'::text, null::integer; return;
  end if;
  select connector_id into v_connector_id from public.connector_connections
    where id = p_connection_id and tenant_id = p_tenant_id and status <> 'disconnected';
  if v_connector_id is null then
    return query select 'not_found'::text, null::integer; return;
  end if;
  v_principal := gateway.actor_principal(p_tenant_id, p_user_id);
  update public.connector_connections
    set status = 'disconnected', disconnected_at = now(), disconnected_by_principal_id = v_principal
    where id = p_connection_id;
  update public.capability_tokens
    set status = 'revoked', revoked_at = now(), revoked_by = 'system',
        revocation_reason = 'Connector connection disconnected'
    where tenant_id = p_tenant_id and status = 'active' and tool like (v_connector_id || '.%');
  get diagnostics v_revoked = row_count;
  return query select 'ok'::text, v_revoked;
end;
$fn$;
revoke all on function gateway.disconnect_connector_connection(uuid, uuid, uuid) from public;
grant execute on function gateway.disconnect_connector_connection(uuid, uuid, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Shared liveness check, mirroring gateway.execution_blocker but generic:
-- no per-task resource binding (see module header), just capability/contract/
-- task/agent/credential liveness plus the connection's own health.
-- ---------------------------------------------------------------------------
create or replace function gateway.connector_execution_blocker(p_capability_id uuid, p_connection_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_tenant uuid; v_task uuid; v_agent uuid; v_cred uuid; v_contract uuid; v_version integer; v_status text;
  v_c_status public.contract_status; v_c_expires timestamptz; v_c_version integer;
  v_task_status public.task_status;
  v_agent_status public.agent_status;
  v_cred_status public.agent_credential_status;
  v_conn_status public.connector_connection_status;
begin
  select ct.tenant_id, ct.task_id, ct.agent_id, ct.credential_id, ct.contract_id, ct.contract_version, ct.status
    into v_tenant, v_task, v_agent, v_cred, v_contract, v_version, v_status
  from public.capability_tokens ct where ct.id = p_capability_id;
  if v_status = 'revoked' then return 'CAPABILITY_REVOKED'; end if;

  select c.contract_status, c.expires_at, c.version into v_c_status, v_c_expires, v_c_version
  from public.task_authority_contracts c where c.id = v_contract and c.tenant_id = v_tenant;
  if v_c_status is null or not authz.contract_is_currently_active(v_c_status, v_c_expires) or v_c_version <> v_version then
    return 'CONTRACT_NO_LONGER_ACTIVE';
  end if;
  select t.status into v_task_status from public.tasks t where t.id = v_task and t.tenant_id = v_tenant;
  if v_task_status is null or v_task_status not in ('contract_issued', 'executing') then return 'TASK_NO_LONGER_EXECUTABLE'; end if;
  select ag.status into v_agent_status from public.agents ag where ag.id = v_agent and ag.tenant_id = v_tenant;
  select ac.status into v_cred_status from public.agent_credentials ac where ac.id = v_cred and ac.tenant_id = v_tenant;
  if v_agent_status is distinct from 'active'::public.agent_status
     or v_cred_status is distinct from 'active'::public.agent_credential_status then
    return 'AGENT_OR_KEY_REVOKED';
  end if;

  select status into v_conn_status from public.connector_connections
    where id = p_connection_id and tenant_id = v_tenant;
  if v_conn_status is null or v_conn_status <> 'active' then return 'CONNECTION_UNAVAILABLE'; end if;
  return null;
end;
$fn$;
revoke all on function gateway.connector_execution_blocker(uuid, uuid) from public;
grant execute on function gateway.connector_execution_blocker(uuid, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Unused budget release reuses gateway.release_unused_budget() as-is
-- (already connector-agnostic — see 20260930000003_two_phase_capabilities.sql).
-- ---------------------------------------------------------------------------

-- Phase 2 of the lifecycle: settle. The single place a connector reservation
-- leaves 'reserved'.
create or replace function gateway.settle_connector_reservation(
  p_execution_id uuid,
  p_category text,
  p_reason_code text,
  p_provider_request_id text,
  p_http_status_class smallint,
  p_resource_ids jsonb,
  p_started_at timestamptz,
  p_redaction jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  r public.connector_reservations%rowtype;
  v_decision uuid;
  v_new_status text;
  v_receipt uuid;
  v_request_id uuid;
  v_spend boolean;
  v_event_type public.execution_event_type;
  v_event_result public.execution_outcome;
  v_cap_status text;
begin
  select * into r from public.connector_reservations where id = p_execution_id;
  if r.id is null or r.status <> 'reserved' then
    raise exception 'reservation is not open' using errcode = '55000';
  end if;

  v_new_status := case p_category
    when 'succeeded' then 'consumed'
    when 'succeeded_noop' then 'consumed'
    when 'failed' then 'failed'
    when 'indeterminate' then 'indeterminate'
    when 'released' then 'released'
  end;
  if v_new_status is null then raise exception 'unknown result category' using errcode = '22023'; end if;
  if p_category = 'released' and r.dispatched_at is not null then
    raise exception 'a dispatched execution cannot be released' using errcode = '55000';
  end if;
  if p_category <> 'released' and r.dispatched_at is null then
    raise exception 'an undispatched execution can only be released' using errcode = '55000';
  end if;
  v_spend := p_category <> 'released';

  select ct.authorization_decision_id, ct.status into v_decision, v_cap_status
  from public.capability_tokens ct where ct.id = r.capability_id;

  insert into public.connector_execution_receipts (
    tenant_id, execution_id, task_id, agent_id, capability_id, authorization_decision_id, connector_id,
    connection_id, tool, operation, resource, request_hash, execution_mode,
    result_category, provider_request_id, http_status_class, resource_ids,
    started_at, finished_at, redaction_metadata, reason_code
  ) values (
    r.tenant_id, r.id, r.task_id, r.agent_id, r.capability_id, v_decision, r.connector_id,
    r.connection_id, r.tool, r.operation, r.resource, r.request_hash, r.execution_mode,
    p_category, p_provider_request_id, p_http_status_class,
    coalesce(p_resource_ids, '{"schemaVersion":1}'::jsonb),
    least(coalesce(p_started_at, r.reserved_at), now()), now(), coalesce(p_redaction, '{"schemaVersion":1}'::jsonb), p_reason_code
  ) returning id into v_receipt;

  update public.connector_reservations
    set status = v_new_status, finished_at = now(), reason_code = p_reason_code
    where id = r.id;

  if v_cap_status = 'revoked' then
    update public.capability_tokens set reserved_uses = reserved_uses - 1 where id = r.capability_id;
  elsif v_spend then
    update public.capability_tokens
      set reserved_uses = reserved_uses - 1,
          uses = uses + 1,
          status = case when uses + 1 >= max_uses then 'consumed' else status end
      where id = r.capability_id;
  else
    update public.capability_tokens set reserved_uses = reserved_uses - 1 where id = r.capability_id;
  end if;
  perform gateway.release_unused_budget(r.capability_id);

  select d.tool_request_id into v_request_id
  from public.authorization_decisions d where d.id = v_decision;

  v_event_type := case when p_category in ('succeeded', 'succeeded_noop') then 'tool_invoked' else 'tool_failed' end;
  v_event_result := case p_category
    when 'succeeded' then 'success' when 'succeeded_noop' then 'success'
    when 'released' then 'info' else 'failure' end;
  insert into public.execution_events (
    tenant_id, task_id, tool_request_id, decision_id, event_type, result_status, summary,
    normalized_effect_metadata, receipt_metadata
  ) values (
    r.tenant_id, r.task_id, v_request_id, v_decision, v_event_type, v_event_result,
    format('%s %s %s (%s): %s', case r.execution_mode when 'live' then 'LIVE' else 'MOCK' end, r.connector_id, r.tool, p_category,
      coalesce(p_reason_code, 'ok')),
    jsonb_build_object('schemaVersion', 1, 'phase', p_category, 'mode', r.execution_mode, 'executionId', r.id),
    jsonb_build_object('schemaVersion', 1, 'receiptId', v_receipt)
  );
  return v_receipt;
end;
$fn$;
revoke all on function gateway.settle_connector_reservation(uuid, text, text, text, smallint, jsonb, timestamptz, jsonb) from public;
grant execute on function gateway.settle_connector_reservation(uuid, text, text, text, smallint, jsonb, timestamptz, jsonb) to authority_gateway;

create or replace function gateway.reconcile_connector_capability(p_capability_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_res public.connector_reservations%rowtype;
  v_n integer := 0;
begin
  for v_res in
    select * from public.connector_reservations
    where capability_id = p_capability_id and status = 'reserved' and lease_expires_at <= now()
    order by reserved_at
  loop
    perform gateway.settle_connector_reservation(
      v_res.id,
      case when v_res.dispatched_at is null then 'released' else 'indeterminate' end,
      case when v_res.dispatched_at is null then 'LEASE_EXPIRED_BEFORE_DISPATCH' else 'LEASE_EXPIRED_AFTER_DISPATCH' end,
      null, null, null, v_res.dispatched_at, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;
revoke all on function gateway.reconcile_connector_capability(uuid) from public;
grant execute on function gateway.reconcile_connector_capability(uuid) to authority_gateway;

create or replace function gateway.reconcile_expired_connector_reservations(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_cap uuid;
  v_n integer := 0;
begin
  for v_cap in
    select distinct r.capability_id from public.connector_reservations r
    where r.status = 'reserved' and r.lease_expires_at <= now() limit greatest(least(coalesce(p_limit, 50), 500), 1)
  loop
    perform pg_advisory_xact_lock(hashtextextended('authority.capability:' || v_cap::text, 0));
    v_n := v_n + gateway.reconcile_connector_capability(v_cap);
  end loop;
  return v_n;
end;
$fn$;
revoke all on function gateway.reconcile_expired_connector_reservations(integer) from public;
grant execute on function gateway.reconcile_expired_connector_reservations(integer) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Phase 1: reserve. Same validation order and idempotency semantics as
-- gateway.reserve_execution, generalized: resolves the active connection for
-- the tool's own provider instead of a GitHub repository/installation.
-- ---------------------------------------------------------------------------
create or replace function gateway.reserve_connector_execution(
  p_credential_secret text,
  p_token_hash text,
  p_tool text,
  p_operation text,
  p_resource text,
  p_args jsonb,
  p_idempotency_key text,
  p_execution_mode text,
  p_lease_seconds integer
)
returns table (
  rce_status text,
  rce_result text,
  rce_reason_code text,
  rce_execution_id uuid,
  rce_capability_id uuid,
  rce_task_id uuid,
  rce_agent_id uuid,
  rce_connector_id text,
  rce_connection_id uuid,
  rce_lease_expires_at timestamptz,
  rce_prev_category text,
  rce_prev_receipt jsonb
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_agent uuid;
  v_cap uuid; v_task uuid; v_resource text; v_constraints jsonb; v_args_hash_expected text;
  v_max integer; v_uses integer; v_reserved integer; v_expires timestamptz; v_cap_status text; v_tool text; v_op text;
  v_args_hash text; v_request_hash text;
  v_prev record;
  v_reason text;
  v_provider text;
  v_conn_id uuid; v_conn_config_version integer;
  v_recent_rejects integer;
  v_exec uuid;
  v_lease timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'malformed capability' using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'idempotency key is required and must be 1-200 characters' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' or pg_column_size(p_args) > 16384 then
    raise exception 'arguments must be an object of at most 16 KB' using errcode = '22023';
  end if;
  if p_execution_mode not in ('mock', 'live') then
    raise exception 'execution mode must be mock or live' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 5 and 300 then
    raise exception 'lease must be 5-300 seconds' using errcode = '22023';
  end if;

  select rc.rc_status, rc.rc_tenant_id, rc.rc_agent_id into v_status, v_tenant, v_agent
  from gateway.resolve_credential(p_credential_secret) rc;
  if v_status <> 'ok' then
    return query select v_status, null::text, null::text, null::uuid, null::uuid, null::uuid, null::uuid,
      null::text, null::uuid, null::timestamptz, null::text, null::jsonb;
    return;
  end if;

  select ct.id, ct.task_id, ct.resource, ct.resource_constraints, ct.arguments_hash, ct.max_uses, ct.tool, ct.operation
    into v_cap, v_task, v_resource, v_constraints, v_args_hash_expected, v_max, v_tool, v_op
  from public.capability_tokens ct
  where ct.token_hash = p_token_hash and ct.tenant_id = v_tenant and ct.agent_id = v_agent;
  if v_cap is null then
    return query select 'ok'::text, 'rejected'::text, 'CAPABILITY_NOT_FOUND'::text, null::uuid, null::uuid, null::uuid, null::uuid,
      null::text, null::uuid, null::timestamptz, null::text, null::jsonb;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.capability:' || v_cap::text, 0));
  perform gateway.reconcile_connector_capability(v_cap);

  select ct.uses, ct.reserved_uses, ct.expires_at, ct.status into v_uses, v_reserved, v_expires, v_cap_status
  from public.capability_tokens ct where ct.id = v_cap;

  v_args_hash := encode(extensions.digest(p_args::text, 'sha256'), 'hex');
  v_request_hash := encode(extensions.digest(
    coalesce(p_tool, '') || '|' || coalesce(p_operation, '') || '|' || coalesce(p_resource, '') || '|' || v_args_hash, 'sha256'), 'hex');

  select r.id, r.request_hash, r.status, r.lease_expires_at, r.reason_code into v_prev
  from public.connector_reservations r where r.capability_id = v_cap and r.idempotency_key = p_idempotency_key;
  if v_prev.id is not null then
    if v_prev.request_hash <> v_request_hash then
      return query select 'ok'::text, 'rejected'::text, 'IDEMPOTENCY_CONFLICT'::text, null::uuid, v_cap, v_task, v_agent,
        null::text, null::uuid, null::timestamptz, null::text, null::jsonb;
    elsif v_prev.status = 'reserved' then
      return query select 'ok'::text, 'in_progress'::text, 'EXECUTION_IN_PROGRESS'::text, v_prev.id, v_cap, v_task, v_agent,
        null::text, null::uuid, v_prev.lease_expires_at, null::text, null::jsonb;
    else
      return query
        select 'ok'::text, 'replayed'::text, v_prev.reason_code, v_prev.id, v_cap, v_task, v_agent, null::text, null::uuid,
               null::timestamptz, v_prev.status,
               (select jsonb_build_object('category', cr.result_category, 'providerRequestId', cr.provider_request_id,
                  'resourceIds', cr.resource_ids, 'httpStatusClass', cr.http_status_class, 'receiptId', cr.id)
                from public.connector_execution_receipts cr where cr.execution_id = v_prev.id);
    end if;
    return;
  end if;
  if exists (select 1 from public.capability_consumptions cc
             where cc.capability_id = v_cap and cc.idempotency_key = p_idempotency_key and cc.request_hash = v_request_hash
               and cc.result = 'rejected' and not cc.simulated) then
    return query select 'ok'::text, 'rejected'::text,
      (select cc.reason_code from public.capability_consumptions cc
        where cc.capability_id = v_cap and cc.idempotency_key = p_idempotency_key limit 1),
      null::uuid, v_cap, v_task, v_agent, null::text, null::uuid, null::timestamptz, null::text, null::jsonb;
    return;
  end if;

  v_provider := split_part(v_tool, '.', 1);

  if v_cap_status = 'revoked' then
    v_reason := 'CAPABILITY_REVOKED';
  elsif v_uses >= v_max then
    v_reason := 'CAPABILITY_ALREADY_USED';
  elsif v_uses + v_reserved >= v_max then
    return query select 'ok'::text, 'rejected'::text, 'RESERVATION_IN_PROGRESS'::text, null::uuid, v_cap, v_task, v_agent,
      null::text, null::uuid, null::timestamptz, null::text, null::jsonb;
    return;
  elsif v_expires <= now() then
    v_reason := 'CAPABILITY_EXPIRED';
  elsif p_tool is distinct from v_tool or p_operation is distinct from v_op or p_resource is distinct from v_resource
        or v_args_hash is distinct from v_args_hash_expected or not gateway.constraints_satisfied(v_constraints, p_args) then
    v_reason := 'SCOPE_MISMATCH';
  end if;

  if v_reason is null then
    select id, config_version into v_conn_id, v_conn_config_version
    from public.connector_connections
    where tenant_id = v_tenant and connector_id = v_provider and status <> 'disconnected';
    if v_conn_id is null then
      v_reason := 'CONNECTOR_NOT_CONFIGURED';
    else
      v_reason := gateway.connector_execution_blocker(v_cap, v_conn_id);
    end if;
  end if;

  if v_reason is not null then
    if v_reason in ('CAPABILITY_ALREADY_USED', 'CAPABILITY_EXPIRED', 'CAPABILITY_REVOKED') then
      perform gateway.release_unused_budget(v_cap);
    end if;
    select count(*) into v_recent_rejects from public.capability_consumptions cc
      where cc.capability_id = v_cap and cc.result = 'rejected' and cc.created_at > now() - interval '60 seconds';
    if v_recent_rejects < 50 then
      insert into public.capability_consumptions (tenant_id, capability_id, agent_id, idempotency_key, request_hash, result, reason_code, simulated)
      values (v_tenant, v_cap, v_agent, p_idempotency_key, v_request_hash, 'rejected', v_reason, false);
    end if;
    return query select 'ok'::text, 'rejected'::text, v_reason, null::uuid, v_cap, v_task, v_agent, null::text, null::uuid,
      null::timestamptz, null::text, null::jsonb;
    return;
  end if;

  v_lease := now() + make_interval(secs => p_lease_seconds);
  insert into public.connector_reservations (
    tenant_id, capability_id, agent_id, task_id, idempotency_key, request_hash, tool, operation, resource,
    connector_id, connection_id, connection_config_version, execution_mode, lease_expires_at
  ) values (
    v_tenant, v_cap, v_agent, v_task, p_idempotency_key, v_request_hash, v_tool, v_op, p_resource,
    v_provider, v_conn_id, v_conn_config_version, p_execution_mode, v_lease
  ) returning id into v_exec;
  update public.capability_tokens set reserved_uses = reserved_uses + 1 where id = v_cap;

  insert into public.execution_events (tenant_id, task_id, tool_request_id, decision_id, event_type, result_status, summary,
    normalized_effect_metadata)
  select v_tenant, v_task, d.tool_request_id, d.id, 'tool_invoked', 'info',
         format('%s %s %s: capability use reserved (execution %s).', upper(p_execution_mode), v_provider, v_tool, left(v_exec::text, 8)),
         jsonb_build_object('schemaVersion', 1, 'phase', 'reserved', 'mode', p_execution_mode, 'executionId', v_exec)
  from public.capability_tokens ct join public.authorization_decisions d on d.id = ct.authorization_decision_id
  where ct.id = v_cap;

  return query select 'ok'::text, 'reserved'::text, 'RESERVED'::text, v_exec, v_cap, v_task, v_agent, v_provider, v_conn_id,
    v_lease, null::text, null::jsonb;
end;
$fn$;
revoke all on function gateway.reserve_connector_execution(text, text, text, text, text, jsonb, text, text, integer) from public;
grant execute on function gateway.reserve_connector_execution(text, text, text, text, text, jsonb, text, text, integer) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Phase 1.5: immediately before dispatch, re-check nothing was revoked.
-- ---------------------------------------------------------------------------
create or replace function gateway.mark_connector_dispatched(p_execution_id uuid, p_agent_id uuid)
returns table (mcd_status text, mcd_reason text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  r public.connector_reservations%rowtype;
  v_blocker text;
begin
  select * into r from public.connector_reservations where id = p_execution_id and agent_id = p_agent_id;
  if r.id is null then return query select 'not_found'::text, null::text; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('authority.capability:' || r.capability_id::text, 0));
  select * into r from public.connector_reservations where id = p_execution_id;
  if r.status <> 'reserved' then return query select 'not_reserved'::text, r.status; return; end if;
  if r.dispatched_at is not null then return query select 'already_dispatched'::text, null::text; return; end if;
  if r.lease_expires_at <= now() then
    perform gateway.reconcile_connector_capability(r.capability_id);
    return query select 'lease_expired'::text, null::text; return;
  end if;
  v_blocker := gateway.connector_execution_blocker(r.capability_id, r.connection_id);
  if v_blocker is not null then
    perform gateway.settle_connector_reservation(r.id, 'released', v_blocker, null, null, null, null, null);
    return query select 'blocked'::text, v_blocker; return;
  end if;
  update public.connector_reservations set dispatched_at = now() where id = r.id;
  insert into public.execution_events (tenant_id, task_id, tool_request_id, decision_id, event_type, result_status, summary,
    normalized_effect_metadata)
  select r.tenant_id, r.task_id, d.tool_request_id, d.id, 'tool_invoked', 'info',
         format('%s %s %s: request dispatched.', upper(r.execution_mode), r.connector_id, r.tool),
         jsonb_build_object('schemaVersion', 1, 'phase', 'dispatched', 'mode', r.execution_mode, 'executionId', r.id)
  from public.capability_tokens ct join public.authorization_decisions d on d.id = ct.authorization_decision_id
  where ct.id = r.capability_id;
  return query select 'ok'::text, null::text;
end;
$fn$;
revoke all on function gateway.mark_connector_dispatched(uuid, uuid) from public;
grant execute on function gateway.mark_connector_dispatched(uuid, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Phase 2: settle wrapper enforcing "only the reserving execution+agent, only
-- while still reserved" — same shape as gateway.finish_execution.
-- ---------------------------------------------------------------------------
create or replace function gateway.finish_connector_execution(
  p_execution_id uuid,
  p_agent_id uuid,
  p_category text,
  p_reason_code text,
  p_provider_request_id text,
  p_http_status_class smallint,
  p_resource_ids jsonb,
  p_started_at timestamptz,
  p_redaction jsonb
)
returns table (fce_status text, fce_receipt_id uuid, fce_final_status text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  r public.connector_reservations%rowtype;
  v_receipt uuid;
begin
  select * into r from public.connector_reservations where id = p_execution_id and agent_id = p_agent_id;
  if r.id is null then return query select 'not_found'::text, null::uuid, null::text; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('authority.capability:' || r.capability_id::text, 0));
  select * into r from public.connector_reservations where id = p_execution_id;
  if r.status <> 'reserved' then
    return query select 'already_final'::text, (select cr.id from public.connector_execution_receipts cr where cr.execution_id = r.id), r.status;
    return;
  end if;
  v_receipt := gateway.settle_connector_reservation(
    p_execution_id, p_category, p_reason_code, p_provider_request_id, p_http_status_class,
    p_resource_ids, p_started_at, p_redaction);
  return query select 'ok'::text, v_receipt,
    (select rr.status from public.connector_reservations rr where rr.id = p_execution_id);
end;
$fn$;
revoke all on function gateway.finish_connector_execution(uuid, uuid, text, text, text, smallint, jsonb, timestamptz, jsonb) from public;
grant execute on function gateway.finish_connector_execution(uuid, uuid, text, text, text, smallint, jsonb, timestamptz, jsonb) to authority_gateway;

-- Admin annotation of an indeterminate execution — same shape as
-- gateway.github_resolve_indeterminate.
create or replace function gateway.resolve_connector_indeterminate(
  p_tenant_id uuid, p_user_id uuid, p_execution_id uuid, p_outcome text, p_note text
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_resolved text;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'security_admin') then return 'forbidden'; end if;
  if p_outcome not in ('executed', 'not_executed') then raise exception 'outcome must be executed or not_executed' using errcode = '22023'; end if;
  select r.status, r.resolved_outcome into v_status, v_resolved
  from public.connector_reservations r where r.id = p_execution_id and r.tenant_id = p_tenant_id for update;
  if v_status is null then return 'not_found'; end if;
  if v_status <> 'indeterminate' then return 'not_indeterminate'; end if;
  if v_resolved is not null then return 'already_resolved'; end if;
  update public.connector_reservations
    set resolved_outcome = p_outcome, resolved_at = now(), resolved_by_principal_id = gateway.actor_principal(p_tenant_id, p_user_id),
        resolution_note = left(p_note, 500)
    where id = p_execution_id;
  return 'ok';
end;
$fn$;
revoke all on function gateway.resolve_connector_indeterminate(uuid, uuid, uuid, text, text) from public;
grant execute on function gateway.resolve_connector_indeterminate(uuid, uuid, uuid, text, text) to authority_gateway;
