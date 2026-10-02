-- Embedded customer connections, part 9: the credential-broker protocol for
-- Mode B ("reuse the application's existing connection").
--
-- When an application already manages its own OAuth client and token
-- storage for a provider, Authority does not need -- and must not try -- to
-- hold or refresh that token itself. Instead, at execution time, Authority
-- asks the application's own registered broker endpoint for a short-lived
-- access token scoped to one pre-registered connection, uses it in memory
-- for exactly one approved connector call, and discards it. No refresh
-- token, no long-lived access token, is ever stored locally for a
-- broker-mode connection -- `connector_connections` for one of these has no
-- row at all in `connector_connection_secrets`.
--
-- The broker is not a generic upstream Authority blindly trusts: its URL is
-- registered once by a tenant admin (never supplied by an agent request,
-- never derived from anything in a tool call), validated against the same
-- SSRF protections Custom API's tenant-supplied base URL already uses
-- (src/lib/connectors/custom-api/network-guard.ts, reused as-is), and every
-- call to it is signed, timestamped and single-use via a nonce the broker is
-- expected to reject on replay.

create table public.connection_brokers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  application_id uuid not null,
  -- HTTPS only; re-validated against the SSRF guard at call time, not just here.
  url         text not null check (url ~ '^https://' and char_length(url) <= 2000),
  -- The shared signing secret lives in Vault, exactly like a connector's own
  -- oauth_refresh_token -- this table never stores or returns it.
  secret_vault_id uuid not null,
  status      text not null default 'active' check (status in ('active', 'revoked')),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  revoked_at  timestamptz,
  revoked_by  uuid references auth.users (id) on delete set null,
  unique (id, tenant_id),
  foreign key (application_id, tenant_id) references public.applications (id, tenant_id),
  check ((status = 'revoked') = (revoked_at is not null))
);

alter table public.connection_brokers enable row level security;
revoke all on public.connection_brokers from public, anon, authenticated;
grant select (id, tenant_id, application_id, url, status, created_at, created_by, revoked_at, revoked_by)
  on public.connection_brokers to authenticated;
create policy "connection_brokers_select_within_tenant" on public.connection_brokers
  for select to authenticated using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- A connection's authentication mode. "managed" (the default, everything
-- built before this migration) means Authority itself holds and refreshes
-- the credential, in Vault, the way every connector already works.
-- "broker" means Authority holds nothing locally for this connection --
-- every execution asks the registered broker for a fresh token instead.
-- ---------------------------------------------------------------------------
alter table public.connector_connections
  add column auth_mode text not null default 'managed' check (auth_mode in ('managed', 'broker')),
  add column broker_id uuid,
  -- The broker's own identifier for this connection/account -- Authority's
  -- connection id is not assumed to mean anything to the application's side.
  add column broker_connection_ref text check (broker_connection_ref is null or char_length(broker_connection_ref) <= 200),
  add constraint connector_connections_broker_shape check (
    (auth_mode = 'broker' and broker_id is not null and broker_connection_ref is not null) or
    (auth_mode = 'managed' and broker_id is null and broker_connection_ref is null)
  ),
  add foreign key (broker_id, tenant_id) references public.connection_brokers (id, tenant_id);

-- ---------------------------------------------------------------------------
-- Register/revoke a broker, dashboard-session RPCs, same shape as every
-- other admin-issued credential in this schema.
-- ---------------------------------------------------------------------------
create or replace function public.create_connection_broker(p_application_id uuid, p_url text, p_shared_secret text)
returns table (cb_status text, cb_broker_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_vault_id uuid;
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'create_connection_broker() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.applications where id = p_application_id;
  if v_tenant_id is null then
    raise exception 'application not found' using errcode = 'P0002';
  end if;
  if not authz.has_min_role(v_tenant_id, 'admin') then
    return query select 'forbidden'::text, null::uuid; return;
  end if;

  if p_url !~ '^https://' or char_length(p_url) > 2000 then
    return query select 'invalid_url'::text, null::uuid; return;
  end if;
  if p_shared_secret is null or char_length(p_shared_secret) not between 32 and 512 then
    return query select 'invalid_secret'::text, null::uuid; return;
  end if;

  v_vault_id := vault.create_secret(p_shared_secret, 'broker:' || p_application_id::text, 'Authority connection-broker shared secret');

  insert into public.connection_brokers (tenant_id, application_id, url, secret_vault_id, created_by)
  values (v_tenant_id, p_application_id, p_url, v_vault_id, (select auth.uid()))
  returning id into v_id;

  return query select 'ok'::text, v_id;
end;
$fn$;
revoke all on function public.create_connection_broker(uuid, text, text) from public, anon;
grant execute on function public.create_connection_broker(uuid, text, text) to authenticated;

create or replace function public.revoke_connection_broker(p_broker_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'revoke_connection_broker() requires an authenticated caller' using errcode = '28000';
  end if;
  select tenant_id into v_tenant_id from public.connection_brokers where id = p_broker_id;
  if v_tenant_id is null then
    return 'not_found';
  end if;
  if not authz.has_min_role(v_tenant_id, 'admin') then
    return 'forbidden';
  end if;
  update public.connection_brokers set status = 'revoked', revoked_at = now(), revoked_by = (select auth.uid())
  where id = p_broker_id and status = 'active';
  -- Revoking the broker does not disconnect connections registered against
  -- it -- an execution attempt will simply fail once it tries to call a
  -- broker that no longer answers for this tenant (see
  -- gateway.resolve_connection_broker below), the same "fail closed, don't
  -- cascade-delete" shape as every other revocation in this schema.
  return 'ok';
end;
$fn$;
revoke all on function public.revoke_connection_broker(uuid) from public, anon;
grant execute on function public.revoke_connection_broker(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Register a broker-mode connection for a specific customer -- the
-- developer-API counterpart of connecting a managed account. No secret is
-- ever accepted or stored here; the broker itself is asked for one at
-- execution time, every time.
-- ---------------------------------------------------------------------------
create or replace function gateway.register_broker_connection(
  p_secret text, p_customer_id uuid, p_connector_id text, p_broker_id uuid,
  p_broker_connection_ref text, p_verified_account_ref text
)
returns table (rbc2_status text, rbc2_connection_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid;
  v_customer_app uuid;
  v_broker_app uuid;
  v_id uuid;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then
    return query select v_status, null::uuid; return;
  end if;

  select application_id into v_customer_app from public.customers where id = p_customer_id and tenant_id = v_tenant;
  if v_customer_app is null or v_customer_app <> v_app then
    return query select 'customer_not_found'::text, null::uuid; return;
  end if;

  select application_id into v_broker_app from public.connection_brokers
  where id = p_broker_id and tenant_id = v_tenant and status = 'active';
  if v_broker_app is null or v_broker_app <> v_app then
    return query select 'broker_not_found'::text, null::uuid; return;
  end if;

  if p_broker_connection_ref is null or char_length(btrim(p_broker_connection_ref)) < 1 then
    return query select 'invalid_broker_connection_ref'::text, null::uuid; return;
  end if;
  if p_verified_account_ref is null or char_length(btrim(p_verified_account_ref)) < 1 then
    return query select 'invalid_verified_account_ref'::text, null::uuid; return;
  end if;

  insert into public.connector_connections (
    tenant_id, connector_id, name, owner_kind, owner_customer_id, verified_account_ref,
    status, auth_mode, broker_id, broker_connection_ref
  ) values (
    v_tenant, p_connector_id, 'Broker connection', 'customer', p_customer_id, btrim(p_verified_account_ref),
    'active', 'broker', p_broker_id, btrim(p_broker_connection_ref)
  )
  returning id into v_id;

  return query select 'ok'::text, v_id;
end;
$fn$;
revoke all on function gateway.register_broker_connection(text, uuid, text, uuid, text, text) from public;
grant execute on function gateway.register_broker_connection(text, uuid, text, uuid, text, text) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Server-side-only resolver for the broker call itself -- same boundary as
-- gateway.resolve_connector_secret: called only from connector execution
-- code on the gateway's own pooled connection, never from a client-facing
-- route, never logged, never returned to an agent.
-- ---------------------------------------------------------------------------
create or replace function gateway.resolve_connection_broker(p_connection_id uuid)
returns table (rcb_status text, rcb_url text, rcb_secret text, rcb_broker_connection_ref text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_broker_id uuid;
  v_ref text;
  v_url text;
  v_vault_id uuid;
  v_broker_status text;
begin
  select broker_id, broker_connection_ref into v_broker_id, v_ref
  from public.connector_connections where id = p_connection_id and auth_mode = 'broker' and status <> 'disconnected';
  if v_broker_id is null then
    return query select 'not_broker_mode'::text, null::text, null::text, null::text; return;
  end if;

  select url, secret_vault_id, status into v_url, v_vault_id, v_broker_status
  from public.connection_brokers where id = v_broker_id;
  if v_broker_status is distinct from 'active' then
    return query select 'broker_revoked'::text, null::text, null::text, null::text; return;
  end if;

  return query
    select 'ok'::text, v_url, (select decrypted_secret from vault.decrypted_secrets where id = v_vault_id), v_ref;
end;
$fn$;
revoke all on function gateway.resolve_connection_broker(uuid) from public;
grant execute on function gateway.resolve_connection_broker(uuid) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000009'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
