-- Embedded customer connections, part 3: who owns a connection, and how
-- many of them a tenant may have.
--
-- `connector_connections_one_active_per_connector` (20261001000001) enforced
-- "one live connection per (tenant, connector_id)" -- correct for a single
-- dashboard-operated account, wrong the moment a tenant has customers with
-- their own separate Gmail accounts. The real constraint a provider actually
-- enforces is "you can't connect the same account twice," not "you can only
-- ever have one connection" -- so uniqueness now keys off the connection's
-- owner (the organization itself, or one specific customer) and its
-- verified provider account identity, once known. This is deliberately NOT
-- one universal shape: a GitHub installation's identity, a Slack workspace's
-- team id, and a Gmail mailbox's address are different things, which is why
-- this is a single opaque `verified_account_ref` column each connector
-- fills in with whatever its own provider calls "the account" -- the
-- constraint only cares that it's stable and unique per provider, not what
-- it looks like.
--
-- Every existing connection becomes organization-owned by this migration's
-- defaults -- never silently assigned to a customer, since no customer
-- concept existed when they were created.

alter table public.connector_connections
  add column owner_kind text not null default 'organization' check (owner_kind in ('organization', 'customer')),
  add column owner_customer_id uuid,
  add column verified_account_ref text check (verified_account_ref is null or char_length(verified_account_ref) <= 200),
  add constraint connector_connections_owner_shape check (
    (owner_kind = 'customer' and owner_customer_id is not null) or
    (owner_kind = 'organization' and owner_customer_id is null)
  ),
  add foreign key (owner_customer_id, tenant_id) references public.customers (id, tenant_id);

comment on column public.connector_connections.owner_kind is
  'organization: dashboard/tenant-wide, usable by any customer explicitly '
  'delegated to it (connection_delegations). customer: owned by exactly one '
  'customer, usable only for that customer''s tasks.';
comment on column public.connector_connections.verified_account_ref is
  'The provider''s own account identity, once confirmed (Gmail address, '
  'Stripe account id, Slack team id, GitHub installation id) -- opaque to '
  'this schema, meaningful only within one connector_id. Null until the '
  'connection is verified, same as a connection awaiting its first health '
  'check today.';

drop index if exists public.connector_connections_one_active_per_connector;

-- One live connection per (owner, verified account) -- the same owner can't
-- connect the same account twice, but can connect several different ones,
-- and two different owners (two customers, or a customer and the
-- organization) can each hold their own connection to the same provider
-- without colliding. `coalesce` folds organization-owned rows (null
-- owner_customer_id) onto one shared value so the index still treats "the
-- organization" as a single owner for this purpose.
create unique index connector_connections_one_per_owner_account
  on public.connector_connections (
    tenant_id, connector_id, owner_kind,
    coalesce(owner_customer_id, '00000000-0000-0000-0000-000000000000'::uuid),
    verified_account_ref
  )
  where status <> 'disconnected' and verified_account_ref is not null;

-- Before verification, a connection has no account identity yet to key on --
-- still cap one unverified, non-disconnected connection per owner per
-- connector, so a half-configured connect flow can't be started twice
-- concurrently and silently fork into two rows racing for the same slot.
create unique index connector_connections_one_unverified_per_owner
  on public.connector_connections (
    tenant_id, connector_id, owner_kind,
    coalesce(owner_customer_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status <> 'disconnected' and verified_account_ref is null;

-- ---------------------------------------------------------------------------
-- Delegation: an organization-owned connection stays organization-owned,
-- but a specific customer may be explicitly granted use of it (e.g. a
-- shared support mailbox every customer's task may read from). Delegation
-- is additive and revocable; it never changes owner_kind/owner_customer_id
-- on the connection itself.
-- ---------------------------------------------------------------------------
create table public.connection_delegations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null,
  customer_id   uuid not null,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null,
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users (id) on delete set null,
  unique (id, tenant_id),
  foreign key (connection_id, tenant_id) references public.connector_connections (id, tenant_id),
  foreign key (customer_id, tenant_id) references public.customers (id, tenant_id)
);

-- At most one *live* delegation per (connection, customer) -- revoking and
-- re-delegating is fine, two simultaneously-active grants to the same pair
-- would just be redundant rows to reconcile.
create unique index connection_delegations_one_live_per_pair
  on public.connection_delegations (connection_id, customer_id) where revoked_at is null;

alter table public.connection_delegations enable row level security;
revoke all on public.connection_delegations from public, anon, authenticated;
grant select on public.connection_delegations to authenticated;
create policy "connection_delegations_select_within_tenant" on public.connection_delegations
  for select to authenticated using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- The one check every later authorization path calls: is this connection
-- usable for this customer, right now? True for a connection the customer
-- owns directly, or an organization connection explicitly (and currently)
-- delegated to them. False the instant a delegation is revoked or the
-- connection changes owner -- there is no caching of this answer anywhere.
-- ---------------------------------------------------------------------------
create or replace function gateway.connection_usable_by_customer(p_connection_id uuid, p_customer_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.connector_connections cc
    where cc.id = p_connection_id
      and cc.status <> 'disconnected'
      and (
        (cc.owner_kind = 'customer' and cc.owner_customer_id = p_customer_id)
        or (
          cc.owner_kind = 'organization'
          and exists (
            select 1 from public.connection_delegations cd
            where cd.connection_id = cc.id and cd.customer_id = p_customer_id and cd.revoked_at is null
          )
        )
      )
  );
$$;
revoke all on function gateway.connection_usable_by_customer(uuid, uuid) from public;
grant execute on function gateway.connection_usable_by_customer(uuid, uuid) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000003'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
