-- Part 1 of the self-service access-management work: lets an admin
-- configure, once, which organization-owned connections an application
-- BACKEND may grant/revoke to its own customers by itself -- without a
-- human clicking Grant in the dashboard for every signup. Purely additive:
-- no existing table, column, function body, or RLS policy is altered.
-- `gateway.connection_usable_by_customer` (the actual authorization check
-- every task-binding/prepare call already relies on) is untouched here --
-- a backend-granted delegation is recorded as an ordinary
-- `connection_delegations` row, so it is already recognized by every
-- existing read path with zero further change.
--
-- Deliberately scoped down from the full access-management design: this
-- migration covers only `scope = 'backend_grantable'` (an admin explicitly
-- allows the backend to grant/revoke this one connection, per customer).
-- `'application_shared'` (every customer of this application may use the
-- connection with no per-customer delegation row at all) is a real,
-- separate follow-up -- it requires extending
-- `connection_usable_by_customer` itself, which is relied upon by every
-- connector's authorization path, and deserves its own careful, isolated
-- change rather than being bundled into this first slice.
-- `'customer_owned'` and `'admin_only'` need no new mechanism: a
-- customer-owned connection (Gmail's embedded OAuth) is already usable with
-- no delegation at all, and "admin only" is simply "no policy row exists
-- for this connection" -- the pre-existing, unchanged default.

create type public.application_access_scope as enum (
  'customer_owned',
  'backend_grantable',
  'application_shared',
  'admin_only'
);

-- Which backend credentials are even allowed to call the grant/revoke RPCs
-- below. Defaults to false: an application's existing backend credentials
-- gain no new capability the moment this migration ships -- an admin must
-- explicitly opt each one in. Agent runtime keys and task session tokens
-- have no such column at all (they are different tables entirely), so
-- there is no code path by which either could ever carry this scope.
alter table public.developer_backend_credentials
  add column can_manage_access boolean not null default false;

create table public.application_connection_access_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  application_id uuid not null,
  connection_id uuid not null,
  scope public.application_access_scope not null default 'admin_only',
  -- null = delegations under this policy never expire on their own
  -- (still individually revocable). A positive bound on how long a
  -- backend-granted delegation may live before it must be re-granted.
  max_grant_seconds integer check (max_grant_seconds is null or max_grant_seconds > 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (application_id, connection_id),
  foreign key (application_id, tenant_id) references public.applications (id, tenant_id),
  foreign key (connection_id, tenant_id) references public.connector_connections (id, tenant_id)
);

alter table public.application_connection_access_policies enable row level security;
revoke all on public.application_connection_access_policies from public, anon, authenticated;
grant select on public.application_connection_access_policies to authenticated;
create policy "application_connection_access_policies_select_within_tenant"
  on public.application_connection_access_policies for select to authenticated
  using (authz.is_member_of(tenant_id));

-- Every `connection_delegations` row this migration's RPCs create is
-- traceable back to the exact backend credential and policy version that
-- authorized it -- `created_by` on that table stays null (it only ever
-- records a human's auth.uid()), so the provenance a backend grant needs
-- lives here instead, on its own append-only audit row, never overwritten.
create table public.backend_connection_access_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  delegation_id uuid not null,
  policy_id uuid not null,
  granted_by_credential_id uuid not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_credential_id uuid,
  unique (id, tenant_id),
  foreign key (delegation_id, tenant_id) references public.connection_delegations (id, tenant_id),
  foreign key (policy_id, tenant_id) references public.application_connection_access_policies (id, tenant_id),
  foreign key (granted_by_credential_id, tenant_id) references public.developer_backend_credentials (id, tenant_id),
  foreign key (revoked_by_credential_id, tenant_id) references public.developer_backend_credentials (id, tenant_id)
);

alter table public.backend_connection_access_grants enable row level security;
revoke all on public.backend_connection_access_grants from public, anon, authenticated;
grant select on public.backend_connection_access_grants to authenticated;
create policy "backend_connection_access_grants_select_within_tenant"
  on public.backend_connection_access_grants for select to authenticated
  using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- Admin configuration: set or clear this application's policy for one
-- connection. auth.uid()-gated and admin-role-gated, same as every other
-- admin RPC in this schema (grant_connection_delegation, etc.) -- never
-- callable by a backend credential.
-- ---------------------------------------------------------------------------
create or replace function public.set_application_connection_access_policy(
  p_application_id uuid, p_connection_id uuid, p_scope public.application_access_scope,
  p_max_grant_seconds integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_conn_tenant uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'set_application_connection_access_policy() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.applications where id = p_application_id;
  if v_tenant_id is null then return 'application_not_found'; end if;
  if not authz.has_min_role(v_tenant_id, 'admin') then return 'forbidden'; end if;

  select tenant_id into v_conn_tenant from public.connector_connections
  where id = p_connection_id and status <> 'disconnected';
  if v_conn_tenant is null or v_conn_tenant <> v_tenant_id then return 'connection_not_found'; end if;

  insert into public.application_connection_access_policies (
    tenant_id, application_id, connection_id, scope, max_grant_seconds, created_by
  ) values (
    v_tenant_id, p_application_id, p_connection_id, p_scope, p_max_grant_seconds, (select auth.uid())
  )
  on conflict (application_id, connection_id) do update
    set scope = excluded.scope, max_grant_seconds = excluded.max_grant_seconds, updated_at = now();

  return 'ok';
end;
$fn$;
revoke all on function public.set_application_connection_access_policy(uuid, uuid, public.application_access_scope, integer) from public, anon;
grant execute on function public.set_application_connection_access_policy(uuid, uuid, public.application_access_scope, integer) to authenticated;

-- Admin configuration: grant or revoke a backend credential's
-- access-management scope. Same auth.uid()/admin-role gate.
create or replace function public.set_backend_credential_access_management_scope(
  p_credential_id uuid, p_can_manage_access boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'set_backend_credential_access_management_scope() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.developer_backend_credentials where id = p_credential_id;
  if v_tenant_id is null then return 'credential_not_found'; end if;
  if not authz.has_min_role(v_tenant_id, 'admin') then return 'forbidden'; end if;

  update public.developer_backend_credentials
  set can_manage_access = p_can_manage_access
  where id = p_credential_id;

  return 'ok';
end;
$fn$;
revoke all on function public.set_backend_credential_access_management_scope(uuid, boolean) from public, anon;
grant execute on function public.set_backend_credential_access_management_scope(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Backend self-service: grant/revoke/list. Every call re-validates against
-- the CURRENT policy row -- a backend credential can never delegate a
-- connection with no 'backend_grantable' policy (including one whose
-- policy was since changed to something else), and can never widen that
-- envelope by any argument it supplies.
-- ---------------------------------------------------------------------------
create or replace function gateway.grant_connection_access_for_backend(
  p_secret text, p_connection_id uuid, p_customer_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid; v_cred uuid;
  v_can_manage boolean;
  v_policy_id uuid; v_scope public.application_access_scope; v_max_grant_seconds integer;
  v_conn_tenant uuid;
  v_customer_tenant uuid;
  v_existing_id uuid;
  v_new_id uuid;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id, rbc_credential_id into v_status, v_tenant, v_app, v_cred
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then return v_status; end if;

  select can_manage_access into v_can_manage from public.developer_backend_credentials where id = v_cred;
  if not coalesce(v_can_manage, false) then return 'forbidden'; end if;

  select tenant_id into v_customer_tenant from public.customers where id = p_customer_id and application_id = v_app;
  if v_customer_tenant is null or v_customer_tenant <> v_tenant then return 'customer_not_found'; end if;

  select tenant_id into v_conn_tenant from public.connector_connections
  where id = p_connection_id and status <> 'disconnected';
  if v_conn_tenant is null or v_conn_tenant <> v_tenant then return 'connection_not_found'; end if;

  select id, scope, max_grant_seconds into v_policy_id, v_scope, v_max_grant_seconds
  from public.application_connection_access_policies
  where application_id = v_app and connection_id = p_connection_id;
  if v_policy_id is null or v_scope <> 'backend_grantable' then
    return 'not_in_envelope';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'authority.backend_access_grant:' || p_connection_id::text || ':' || p_customer_id::text, 0));

  select id into v_existing_id from public.connection_delegations
  where connection_id = p_connection_id and customer_id = p_customer_id and revoked_at is null;
  if v_existing_id is not null then
    return 'ok';
  end if;

  insert into public.connection_delegations (tenant_id, connection_id, customer_id)
  values (v_tenant, p_connection_id, p_customer_id)
  returning id into v_new_id;

  insert into public.backend_connection_access_grants (
    tenant_id, delegation_id, policy_id, granted_by_credential_id
  ) values (v_tenant, v_new_id, v_policy_id, v_cred);

  return 'ok';
end;
$fn$;
revoke all on function gateway.grant_connection_access_for_backend(text, uuid, uuid) from public;
grant execute on function gateway.grant_connection_access_for_backend(text, uuid, uuid) to authority_gateway;

create or replace function gateway.revoke_connection_access_for_backend(
  p_secret text, p_connection_id uuid, p_customer_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid; v_cred uuid;
  v_can_manage boolean;
  v_delegation_id uuid;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id, rbc_credential_id into v_status, v_tenant, v_app, v_cred
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then return v_status; end if;

  select can_manage_access into v_can_manage from public.developer_backend_credentials where id = v_cred;
  if not coalesce(v_can_manage, false) then return 'forbidden'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'authority.backend_access_grant:' || p_connection_id::text || ':' || p_customer_id::text, 0));

  select id into v_delegation_id from public.connection_delegations
  where connection_id = p_connection_id and customer_id = p_customer_id and revoked_at is null
    and tenant_id = v_tenant;
  if v_delegation_id is null then
    return 'ok';
  end if;

  update public.connection_delegations
  set revoked_at = now()
  where id = v_delegation_id;

  update public.backend_connection_access_grants
  set revoked_at = now(), revoked_by_credential_id = v_cred
  where delegation_id = v_delegation_id and revoked_at is null;

  return 'ok';
end;
$fn$;
revoke all on function gateway.revoke_connection_access_for_backend(text, uuid, uuid) from public;
grant execute on function gateway.revoke_connection_access_for_backend(text, uuid, uuid) to authority_gateway;

create or replace function gateway.list_connection_access_for_backend(p_secret text, p_customer_id uuid)
returns table (lca_status text, lca_connection_id uuid, lca_connector_id text, lca_granted_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid;
  v_customer_tenant uuid;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::text, null::timestamptz; return;
  end if;

  select tenant_id into v_customer_tenant from public.customers where id = p_customer_id and application_id = v_app;
  if v_customer_tenant is null or v_customer_tenant <> v_tenant then
    return query select 'customer_not_found'::text, null::uuid, null::text, null::timestamptz; return;
  end if;

  return query
    select 'ok'::text, cd.connection_id, cc.connector_id, cd.created_at
    from public.connection_delegations cd
    join public.connector_connections cc on cc.id = cd.connection_id and cc.tenant_id = v_tenant
    where cd.customer_id = p_customer_id and cd.revoked_at is null and cd.tenant_id = v_tenant
    union all
    select 'ok'::text, null::uuid, null::text, null::timestamptz
    where not exists (
      select 1 from public.connection_delegations cd2
      where cd2.customer_id = p_customer_id and cd2.revoked_at is null and cd2.tenant_id = v_tenant
    );
end;
$fn$;
revoke all on function gateway.list_connection_access_for_backend(text, uuid) from public;
grant execute on function gateway.list_connection_access_for_backend(text, uuid) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000020'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
