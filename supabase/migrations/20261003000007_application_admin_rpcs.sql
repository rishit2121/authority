-- Embedded customer connections, part 7: the dashboard-session RPCs a human
-- admin needs to actually set this feature up, instead of a direct SQL
-- insert. Same shape as create_agent_credential/create_backend_credential:
-- `auth.uid()` required, `authz.has_min_role()` checked explicitly, never a
-- caller-supplied tenant id trusted as identity.

create or replace function public.create_application(
  p_tenant_id uuid, p_name text, p_slug text, p_environment public.tenant_environment
)
returns table (app_status text, app_application_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'create_application() requires an authenticated caller' using errcode = '28000';
  end if;

  -- p_tenant_id is checked, not trusted: authz.has_min_role() re-verifies
  -- real membership for this exact user and tenant, the same pattern
  -- create_task()/create_connector_connection() already use. A wrong or
  -- forged tenant id simply fails this check, since it depends on the
  -- caller's own row in tenant_memberships, not on the argument itself.
  if not authz.has_min_role(p_tenant_id, 'admin') then
    return query select 'forbidden'::text, null::uuid; return;
  end if;

  insert into public.applications (tenant_id, name, slug, environment, created_by)
  values (p_tenant_id, btrim(p_name), btrim(p_slug), p_environment, (select auth.uid()))
  returning id into v_id;

  return query select 'ok'::text, v_id;
end;
$fn$;
revoke all on function public.create_application(uuid, text, text, public.tenant_environment) from public, anon;
grant execute on function public.create_application(uuid, text, text, public.tenant_environment) to authenticated;

create or replace function public.update_application_return_urls(p_application_id uuid, p_return_urls text[])
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'update_application_return_urls() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.applications where id = p_application_id;
  if v_tenant_id is null then
    return 'not_found';
  end if;
  if not authz.has_min_role(v_tenant_id, 'admin') then
    return 'forbidden';
  end if;
  if p_return_urls is not null and array_length(p_return_urls, 1) > 20 then
    return 'too_many_urls';
  end if;
  if exists (select 1 from unnest(coalesce(p_return_urls, '{}'::text[])) u where char_length(u) > 2000 or u !~ '^https?://') then
    return 'invalid_url';
  end if;

  update public.applications set allowed_return_urls = coalesce(p_return_urls, '{}'::text[])
  where id = p_application_id;

  return 'ok';
end;
$fn$;
revoke all on function public.update_application_return_urls(uuid, text[]) from public, anon;
grant execute on function public.update_application_return_urls(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Delegation management: an admin grants or revokes a specific customer's
-- use of an organization-owned connection. Never usable to delegate a
-- customer-owned connection (owner_kind must already be 'organization') --
-- a customer's own connection is never shared to another customer this way.
-- ---------------------------------------------------------------------------
create or replace function public.grant_connection_delegation(p_connection_id uuid, p_customer_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_owner_kind text;
  v_customer_tenant uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'grant_connection_delegation() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id, owner_kind into v_tenant_id, v_owner_kind
  from public.connector_connections where id = p_connection_id and status <> 'disconnected';
  if v_tenant_id is null then
    return 'connection_not_found';
  end if;
  if not authz.has_min_role(v_tenant_id, 'admin') then
    return 'forbidden';
  end if;
  if v_owner_kind <> 'organization' then
    return 'connection_not_organization_owned';
  end if;

  select tenant_id into v_customer_tenant from public.customers where id = p_customer_id;
  if v_customer_tenant is distinct from v_tenant_id then
    return 'customer_not_found';
  end if;

  insert into public.connection_delegations (tenant_id, connection_id, customer_id, created_by)
  values (v_tenant_id, p_connection_id, p_customer_id, (select auth.uid()))
  on conflict (connection_id, customer_id) where revoked_at is null do nothing;

  return 'ok';
end;
$fn$;
revoke all on function public.grant_connection_delegation(uuid, uuid) from public, anon;
grant execute on function public.grant_connection_delegation(uuid, uuid) to authenticated;

create or replace function public.revoke_connection_delegation(p_connection_id uuid, p_customer_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_updated integer;
begin
  if (select auth.uid()) is null then
    raise exception 'revoke_connection_delegation() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.connector_connections where id = p_connection_id;
  if v_tenant_id is null then
    return 'connection_not_found';
  end if;
  if not authz.has_min_role(v_tenant_id, 'admin') then
    return 'forbidden';
  end if;

  update public.connection_delegations set revoked_at = now(), revoked_by = (select auth.uid())
  where connection_id = p_connection_id and customer_id = p_customer_id and revoked_at is null;
  get diagnostics v_updated = row_count;

  return case when v_updated > 0 then 'ok' else 'not_found' end;
end;
$fn$;
revoke all on function public.revoke_connection_delegation(uuid, uuid) from public, anon;
grant execute on function public.revoke_connection_delegation(uuid, uuid) to authenticated;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000007'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
