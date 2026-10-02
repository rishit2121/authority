-- Embedded customer connections, part 4: a task belongs to a customer (or
-- doesn't, for the pre-existing dashboard path), and connector execution
-- must resolve a connection the same unambiguous way regardless of how many
-- connections the tenant now has for one provider.
--
-- tasks.customer_id is nullable and additive: every existing task has it
-- null, meaning "not customer-scoped," and the resolution change below
-- treats that exactly like today -- implicit first-use binding against
-- organization-owned connections, which is the only kind that existed
-- before this feature. A customer-scoped task (created through the
-- developer API in a later migration) is expected to arrive pre-bound via
-- task_connector_bindings; this migration does not change how a binding is
-- created for that case, only how reserve_connector_execution consumes one.

alter table public.tasks add column customer_id uuid;
alter table public.tasks
  add foreign key (customer_id, tenant_id) references public.customers (id, tenant_id);

comment on column public.tasks.customer_id is
  'Set only for a task created through the developer API on behalf of one '
  'external customer. Null for every dashboard-created task, exactly the '
  'pre-existing behavior.';

create index tasks_customer_idx on public.tasks (customer_id) where customer_id is not null;

-- Records whether a binding was pinned implicitly (first successful
-- reservation, the only behavior that existed before this feature) or
-- created explicitly up front (the developer API, for a customer-scoped
-- task). Audit/UI-only -- the uniqueness and immutability of a binding do
-- not depend on this column.
alter table public.task_connector_bindings
  add column bound_by text not null default 'first_use' check (bound_by in ('first_use', 'explicit'));

-- ---------------------------------------------------------------------------
-- Explicit pre-binding for a customer-scoped task, called once per
-- (task, connector) at task-creation time by the developer API (next
-- migration). Requires the connection to actually be usable by the task's
-- own customer right now -- owned by them directly, or delegated to them --
-- so a backend credential can never pre-bind a task to another customer's
-- connection even by mistake, let alone by a forged request.
-- ---------------------------------------------------------------------------
create or replace function gateway.bind_task_connector(
  p_tenant_id uuid, p_task_id uuid, p_connector_id text, p_connection_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_task_customer uuid;
  v_conn_tenant uuid;
begin
  select customer_id into v_task_customer from public.tasks where id = p_task_id and tenant_id = p_tenant_id;
  if not found then
    return 'task_not_found';
  end if;
  if v_task_customer is null then
    return 'task_not_customer_scoped';
  end if;

  select tenant_id into v_conn_tenant from public.connector_connections
  where id = p_connection_id and tenant_id = p_tenant_id and status <> 'disconnected';
  if v_conn_tenant is null then
    return 'connection_not_found';
  end if;

  if not gateway.connection_usable_by_customer(p_connection_id, v_task_customer) then
    return 'connection_not_usable_by_customer';
  end if;

  insert into public.task_connector_bindings (tenant_id, task_id, connector_id, connection_id, bound_by)
  values (p_tenant_id, p_task_id, p_connector_id, p_connection_id, 'explicit')
  on conflict (task_id, connector_id) do nothing;

  if not found then
    -- A row already exists for this (task, connector) -- bindings are
    -- append-only, so this is only ever a no-op repeat of the same bind,
    -- never a silent overwrite of a different connection.
    if exists (
      select 1 from public.task_connector_bindings
      where task_id = p_task_id and tenant_id = p_tenant_id and connector_id = p_connector_id
        and connection_id = p_connection_id
    ) then
      return 'ok';
    end if;
    return 'already_bound_to_different_connection';
  end if;

  return 'ok';
end;
$fn$;
revoke all on function gateway.bind_task_connector(uuid, uuid, text, uuid) from public;
grant execute on function gateway.bind_task_connector(uuid, uuid, text, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- reserve_connector_execution: identical signature and every behavior
-- unrelated to connection resolution (capability/idempotency/reservation
-- bookkeeping, all untouched below). The connection-resolution block is
-- rewritten so a pre-bound task (explicit or first-use) never re-derives
-- "the tenant's connection for this provider" at all -- it just re-verifies
-- the one it already has, which is what makes this safe once a tenant can
-- hold several simultaneous connections per provider. A never-bound task
-- now only auto-binds against organization-owned connections, and errors
-- explicitly instead of guessing when more than one candidate exists.
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
  v_bound_connection_id uuid;
  v_task_customer uuid;
  v_candidate_count integer;
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

  -- Resolve which connection this reservation uses. See this migration's
  -- own module comment for why a pre-bound task never re-derives "the
  -- tenant's connection" here, and why a never-bound task's implicit
  -- first-use binding now considers organization-owned connections only and
  -- errors explicitly on ambiguity rather than taking an arbitrary row.
  if v_reason is null then
    select t.customer_id into v_task_customer from public.tasks t where t.id = v_task and t.tenant_id = v_tenant;

    select connection_id into v_bound_connection_id
    from public.task_connector_bindings where task_id = v_task and tenant_id = v_tenant and connector_id = v_provider;

    if v_bound_connection_id is not null then
      select id, config_version into v_conn_id, v_conn_config_version
      from public.connector_connections
      where id = v_bound_connection_id and tenant_id = v_tenant and status <> 'disconnected';
      if v_conn_id is null then
        v_reason := 'CONNECTOR_CONNECTION_CHANGED';
      elsif v_task_customer is not null and not gateway.connection_usable_by_customer(v_bound_connection_id, v_task_customer) then
        v_reason := 'CONNECTION_DELEGATION_REVOKED';
      end if;
    else
      select count(*) into v_candidate_count
      from public.connector_connections
      where tenant_id = v_tenant and connector_id = v_provider and status <> 'disconnected' and owner_kind = 'organization';

      if v_candidate_count = 0 then
        v_reason := 'CONNECTOR_NOT_CONFIGURED';
      elsif v_candidate_count > 1 then
        v_reason := 'AMBIGUOUS_CONNECTOR_CONNECTION';
      else
        select id, config_version into v_conn_id, v_conn_config_version
        from public.connector_connections
        where tenant_id = v_tenant and connector_id = v_provider and status <> 'disconnected' and owner_kind = 'organization';

        insert into public.task_connector_bindings (tenant_id, task_id, connector_id, connection_id, bound_by)
        values (v_tenant, v_task, v_provider, v_conn_id, 'first_use')
        on conflict (task_id, connector_id) do nothing
        returning connection_id into v_bound_connection_id;
        if v_bound_connection_id is null then
          -- Lost a concurrent race to bind; re-read the winner's binding.
          select connection_id into v_bound_connection_id
          from public.task_connector_bindings where task_id = v_task and tenant_id = v_tenant and connector_id = v_provider;
          if v_bound_connection_id is distinct from v_conn_id then
            v_reason := 'CONNECTOR_CONNECTION_CHANGED';
          end if;
        end if;
      end if;
    end if;

    if v_reason is null then
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

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000004'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
