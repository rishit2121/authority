-- Part 2 of the self-service access-management work: implements
-- `application_access_scope.'application_shared'`, deliberately deferred
-- out of 20261003000020 as its own, separately-reviewable change, since it
-- means extending `gateway.connection_usable_by_customer` -- the one
-- function every connector's task creation/binding/prepare path already
-- relies on for the customer-isolation boundary.
--
-- Strictly additive widening, never a narrowing: the only new case is a
-- third `exists` branch checking for an `application_shared` policy row.
-- Both pre-existing cases (`owner_kind = 'customer'`, and
-- `owner_kind = 'organization'` with an explicit `connection_delegations`
-- row) are reproduced byte-for-byte from 20261003000003's definition.
-- Nothing changes for any EXISTING connection unless an admin explicitly
-- sets its policy to `application_shared` -- the policy table's own
-- default scope is `admin_only`, so a connection with no policy row at all
-- (every connection that existed before 20261003000020) behaves exactly as
-- it always has.
--
-- Scoped by (connection, application), not just (connection, tenant): a
-- customer of a DIFFERENT application in the same tenant gets no access
-- through this application's `application_shared` policy -- that
-- application would need its own policy row for the same connection.
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
          and (
            exists (
              select 1 from public.connection_delegations cd
              where cd.connection_id = cc.id and cd.customer_id = p_customer_id and cd.revoked_at is null
            )
            or exists (
              select 1
              from public.application_connection_access_policies p
              join public.customers c on c.application_id = p.application_id
              where p.connection_id = cc.id and p.scope = 'application_shared' and c.id = p_customer_id
            )
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
as $$ select '20261003000021'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
