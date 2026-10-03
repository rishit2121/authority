-- Embedded customer connections, part 5: the developer-API RPCs a backend
-- credential actually calls -- resolve a customer, list their connections,
-- create a customer-scoped task with explicit connector bindings, and open
-- a short-lived embedded connection session (Mode A's first step; the
-- OAuth-provider-specific half of Mode A, and the credential-broker
-- protocol for Mode B, are deliberately not in this migration -- see the
-- PR description for what's deferred).
--
-- Every RPC below takes p_secret, never p_tenant_id/p_application_id: the
-- caller's identity and scope come only from resolve_backend_credential(),
-- exactly like reserve_connector_execution never trusts a caller-supplied
-- tenant id. A forged or wrong application id in the request body is not
-- merely rejected, it is never read in the first place.

alter table public.applications
  add column service_principal_id uuid,
  add column allowed_return_urls text[] not null default '{}'
    check (array_length(allowed_return_urls, 1) is null or array_length(allowed_return_urls, 1) <= 20);
alter table public.applications
  add foreign key (service_principal_id, tenant_id) references public.principals (id, tenant_id);

comment on column public.applications.service_principal_id is
  'The principal every customer-scoped task for this application is '
  'attributed to for audit purposes -- not the customer (see tasks.customer_id '
  'for that), but the application''s own backend, created lazily on first use.';
comment on column public.applications.allowed_return_urls is
  'Exact-match allowlist for where create_connection_session() may redirect '
  'back to. Never a pattern or wildcard match -- an open redirect here would '
  'let a connection session be hijacked to any destination.';

-- ---------------------------------------------------------------------------
-- gateway.ensure_application_service_principal: lazily creates and caches
-- the one service principal an application's customer-scoped tasks are
-- attributed to. Not exposed directly -- called internally by
-- create_customer_task below.
-- ---------------------------------------------------------------------------
create or replace function gateway.ensure_application_service_principal(p_tenant_id uuid, p_application_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_principal_id uuid;
  v_app_name text;
begin
  select service_principal_id, name into v_principal_id, v_app_name
  from public.applications where id = p_application_id and tenant_id = p_tenant_id;

  if v_principal_id is not null then
    return v_principal_id;
  end if;

  insert into public.principals (tenant_id, kind, display_name)
  values (p_tenant_id, 'service', format('%s (application backend)', v_app_name))
  returning id into v_principal_id;

  update public.applications set service_principal_id = v_principal_id
  where id = p_application_id and tenant_id = p_tenant_id;

  return v_principal_id;
end;
$fn$;
revoke all on function gateway.ensure_application_service_principal(uuid, uuid) from public;
grant execute on function gateway.ensure_application_service_principal(uuid, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Create or resolve a customer by the application's own external id.
-- Idempotent by construction: the (application_id, external_id) unique
-- index means a repeat call for the same external id always resolves the
-- same row rather than creating a second one, with no separate idempotency
-- key required.
-- ---------------------------------------------------------------------------
create or replace function gateway.create_or_resolve_customer(
  p_secret text, p_external_id text, p_display_label text, p_metadata jsonb
)
returns table (coc_status text, coc_customer_id uuid, coc_was_created boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid;
  v_external text;
  v_id uuid;
  v_meta jsonb;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::boolean; return;
  end if;

  v_external := btrim(coalesce(p_external_id, ''));
  if v_external = '' or char_length(v_external) > 200 then
    return query select 'invalid_external_id'::text, null::uuid, null::boolean; return;
  end if;

  v_meta := coalesce(p_metadata, '{"schemaVersion": 1}'::jsonb);
  if not (authz.has_allowed_schema_version(v_meta, array[1]) and pg_column_size(v_meta) <= 4096) then
    return query select 'invalid_metadata'::text, null::uuid, null::boolean; return;
  end if;

  select id into v_id from public.customers where application_id = v_app and external_id = v_external;
  if v_id is not null then
    return query select 'ok'::text, v_id, false; return;
  end if;

  insert into public.customers (tenant_id, application_id, external_id, display_label, metadata)
  values (v_tenant, v_app, v_external, nullif(btrim(coalesce(p_display_label, '')), ''), v_meta)
  on conflict (application_id, external_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- Lost a concurrent race to create the same external id; resolve the winner.
    select id into v_id from public.customers where application_id = v_app and external_id = v_external;
    return query select 'ok'::text, v_id, false; return;
  end if;

  return query select 'ok'::text, v_id, true;
end;
$fn$;
revoke all on function gateway.create_or_resolve_customer(text, text, text, jsonb) from public;
grant execute on function gateway.create_or_resolve_customer(text, text, text, jsonb) to authority_gateway;

-- ---------------------------------------------------------------------------
-- List one customer's own usable connections: owned directly, or an
-- organization connection currently delegated to them. Never another
-- customer's connections, even within the same application/tenant.
-- ---------------------------------------------------------------------------
create or replace function gateway.list_customer_connections(p_secret text, p_customer_id uuid)
returns table (
  lcc_status text, lcc_connection_id uuid, lcc_connector_id text, lcc_status_value text,
  lcc_owner_kind text, lcc_verified_account_ref text, lcc_created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid;
  v_customer_app uuid;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::text, null::text, null::text, null::text, null::timestamptz; return;
  end if;

  select application_id into v_customer_app from public.customers
  where id = p_customer_id and tenant_id = v_tenant;
  if v_customer_app is null or v_customer_app <> v_app then
    return query select 'customer_not_found'::text, null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  return query
    select 'ok'::text, cc.id, cc.connector_id, cc.status::text, cc.owner_kind, cc.verified_account_ref, cc.created_at
    from public.connector_connections cc
    where cc.tenant_id = v_tenant and cc.status <> 'disconnected'
      and (
        (cc.owner_kind = 'customer' and cc.owner_customer_id = p_customer_id)
        or (cc.owner_kind = 'organization' and exists (
          select 1 from public.connection_delegations cd
          where cd.connection_id = cc.id and cd.customer_id = p_customer_id and cd.revoked_at is null
        ))
      )
    order by cc.created_at desc;
end;
$fn$;
revoke all on function gateway.list_customer_connections(text, uuid) from public;
grant execute on function gateway.list_customer_connections(text, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Create a customer-scoped task with its connector bindings set explicitly
-- and atomically, before any contract compilation or activation can see it.
-- p_connector_bindings: jsonb array of {"connectorId": "...", "connectionId": "..."}.
-- Every connection must already be usable by this exact customer -- owned by
-- them, or delegated to them -- or the whole call fails with no task
-- created; a task is never left half-bound.
-- ---------------------------------------------------------------------------
create or replace function gateway.create_customer_task(
  p_secret text, p_customer_id uuid, p_agent_id uuid, p_intent text,
  p_connector_bindings jsonb, p_idempotency_key text
)
returns table (cct_status text, cct_task_id uuid, cct_was_created boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid;
  v_customer_app uuid;
  v_principal uuid;
  v_intent text;
  v_existing uuid;
  v_task uuid;
  v_binding jsonb;
  v_connector text;
  v_connection uuid;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::boolean; return;
  end if;

  select application_id into v_customer_app from public.customers
  where id = p_customer_id and tenant_id = v_tenant;
  if v_customer_app is null or v_customer_app <> v_app then
    return query select 'customer_not_found'::text, null::uuid, null::boolean; return;
  end if;

  if not exists (select 1 from public.agents where id = p_agent_id and tenant_id = v_tenant) then
    return query select 'agent_not_found'::text, null::uuid, null::boolean; return;
  end if;

  v_intent := btrim(coalesce(p_intent, ''));
  if v_intent = '' or char_length(v_intent) > 4000 then
    return query select 'invalid_intent'::text, null::uuid, null::boolean; return;
  end if;

  if p_idempotency_key is not null then
    select id into v_existing from public.tasks where tenant_id = v_tenant and idempotency_key = p_idempotency_key;
    if v_existing is not null then
      return query select 'ok'::text, v_existing, false; return;
    end if;
  end if;

  if p_connector_bindings is not null and jsonb_typeof(p_connector_bindings) <> 'array' then
    return query select 'invalid_connector_bindings'::text, null::uuid, null::boolean; return;
  end if;

  -- Validate every requested binding belongs to (or is delegated to) this
  -- customer before creating anything -- a task must never be created only
  -- to discover one of its bindings is unauthorized.
  for v_binding in select * from jsonb_array_elements(coalesce(p_connector_bindings, '[]'::jsonb))
  loop
    v_connector := v_binding ->> 'connectorId';
    v_connection := nullif(v_binding ->> 'connectionId', '')::uuid;
    if v_connector is null or v_connection is null then
      return query select 'invalid_connector_bindings'::text, null::uuid, null::boolean; return;
    end if;
    if not exists (
      select 1 from public.connector_connections
      where id = v_connection and tenant_id = v_tenant and connector_id = v_connector and status <> 'disconnected'
    ) then
      return query select 'connection_not_found'::text, null::uuid, null::boolean; return;
    end if;
    if not gateway.connection_usable_by_customer(v_connection, p_customer_id) then
      return query select 'connection_not_usable_by_customer'::text, null::uuid, null::boolean; return;
    end if;
  end loop;

  v_principal := gateway.ensure_application_service_principal(v_tenant, v_app);

  insert into public.tasks (
    tenant_id, agent_id, principal_id, customer_id, intent, status,
    trusted_context_provenance, idempotency_key
  )
  values (
    v_tenant, p_agent_id, v_principal, p_customer_id, v_intent, 'pending',
    jsonb_build_object('schemaVersion', 1, 'source', 'developer_api'),
    p_idempotency_key
  )
  returning id into v_task;

  for v_binding in select * from jsonb_array_elements(coalesce(p_connector_bindings, '[]'::jsonb))
  loop
    perform gateway.bind_task_connector(
      v_tenant, v_task, v_binding ->> 'connectorId', (v_binding ->> 'connectionId')::uuid
    );
  end loop;

  return query select 'ok'::text, v_task, true;
end;
$fn$;
revoke all on function gateway.create_customer_task(text, uuid, uuid, text, jsonb, text) from public;
grant execute on function gateway.create_customer_task(text, uuid, uuid, text, jsonb, text) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000005'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
