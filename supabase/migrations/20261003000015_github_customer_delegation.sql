-- Developer API, part 2: brings GitHub into the same customer-scoped,
-- backend-credential-driven workflow Gmail/Stripe/Slack/Postgres/Custom API
-- already have -- additively, without touching GitHub's own existing
-- execution path at all.
--
-- GitHub was deliberately left off the generic `connector_connections` /
-- `owner_kind` / `connection_delegations` model (see register.ts's own
-- comment: "registering it here would make it reachable from two different
-- code paths with two different execution histories"). A GitHub repository
-- isn't an OAuth connection anyway -- it's a row in the tenant's own
-- `github_repositories` allowlist, bound once per task via
-- `task_repository_bindings`. What GitHub was actually missing was a
-- CUSTOMER-scoping layer on top of that existing allowlist, equivalent in
-- spirit to `connection_delegations` but built for repositories: a
-- `github_repository_customer_delegations` junction table, admin-managed,
-- exactly as explicit an action as delegating an organization connection
-- already is.
--
-- Everything that already worked keeps working unchanged:
--  - `public.github_bind_task_repository` (dashboard, auth.uid()-gated) is
--    redefined to delegate to a new shared core
--    (`gateway.github_bind_task_repository_core`) containing its exact
--    prior body -- byte-identical external behavior, same signature.
--  - Execution (`/api/v1/github/execute`, `gateway.reserve_execution`,
--    `gateway.is_connector_tool`), approvals, replay protection and
--    indeterminate-write handling are not touched by this migration at all.
--  - The repository allowlist itself (`github_repositories.allowed`,
--    admin-controlled) is unchanged and still the first gate: a repository
--    delegated to a customer but not allowed by an admin is still refused.
--
-- What's new: `gateway.github_bind_task_repository_for_backend` additionally
-- requires the task's own customer to have an ACTIVE delegation for the
-- named repository -- every backend-driven task is customer-scoped (see
-- `gateway.get_task_for_backend`'s own `customer_id is null` check), so this
-- is never optional for that path, unlike the dashboard path, where a human
-- developer can still bind any allowed repository directly (unchanged,
-- matching how a human admin could already do anything a delegation would
-- otherwise gate for the other connectors).

-- ---------------------------------------------------------------------------
-- 1. The delegation table.
-- ---------------------------------------------------------------------------
create table public.github_repository_customer_delegations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  repository_id uuid not null,
  customer_id   uuid not null,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null,
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users (id) on delete set null,
  unique (id, tenant_id),
  foreign key (repository_id, tenant_id) references public.github_repositories (id, tenant_id),
  foreign key (customer_id, tenant_id) references public.customers (id, tenant_id),
  check ((revoked_at is not null) = (revoked_by is not null))
);
comment on table public.github_repository_customer_delegations is
  'Which customer(s) a given GitHub repository is available to through the '
  'backend-credential developer API -- explicit, admin-granted, independent '
  'of the repository allowlist itself (github_repositories.allowed), the '
  'same way an organization connector_connection still needs an explicit '
  'connection_delegations row before any customer may use it.';

create unique index github_repo_delegations_one_live_per_pair
  on public.github_repository_customer_delegations (repository_id, customer_id) where revoked_at is null;

alter table public.github_repository_customer_delegations enable row level security;
revoke all on public.github_repository_customer_delegations from public, anon, authenticated;
grant select on public.github_repository_customer_delegations to authenticated;
create policy "github_repo_delegations_select_within_tenant" on public.github_repository_customer_delegations
  for select to authenticated using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- 2. Dashboard-facing admin RPCs -- mirror grant/revoke_connection_delegation
--    exactly (20261003000007_application_admin_rpcs.sql).
-- ---------------------------------------------------------------------------
create or replace function public.delegate_github_repository_to_customer(p_repository_id uuid, p_customer_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_customer_tenant uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'delegate_github_repository_to_customer() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.github_repositories where id = p_repository_id;
  if v_tenant_id is null then
    return 'repository_not_found';
  end if;
  if not authz.has_min_role(v_tenant_id, 'admin') then
    return 'forbidden';
  end if;

  select tenant_id into v_customer_tenant from public.customers where id = p_customer_id;
  if v_customer_tenant is null or v_customer_tenant <> v_tenant_id then
    return 'customer_not_found';
  end if;

  insert into public.github_repository_customer_delegations (tenant_id, repository_id, customer_id, created_by)
  values (v_tenant_id, p_repository_id, p_customer_id, (select auth.uid()))
  on conflict (repository_id, customer_id) where revoked_at is null do nothing;

  return 'ok';
end;
$fn$;
revoke all on function public.delegate_github_repository_to_customer(uuid, uuid) from public, anon;
grant execute on function public.delegate_github_repository_to_customer(uuid, uuid) to authenticated;

create or replace function public.revoke_github_repository_delegation(p_repository_id uuid, p_customer_id uuid)
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
    raise exception 'revoke_github_repository_delegation() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.github_repositories where id = p_repository_id;
  if v_tenant_id is null then
    return 'repository_not_found';
  end if;
  if not authz.has_min_role(v_tenant_id, 'admin') then
    return 'forbidden';
  end if;

  update public.github_repository_customer_delegations
    set revoked_at = now(), revoked_by = (select auth.uid())
  where repository_id = p_repository_id and customer_id = p_customer_id and revoked_at is null;
  get diagnostics v_updated = row_count;

  return case when v_updated > 0 then 'ok' else 'not_found' end;
end;
$fn$;
revoke all on function public.revoke_github_repository_delegation(uuid, uuid) from public, anon;
grant execute on function public.revoke_github_repository_delegation(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The one check every backend-driven repository use calls -- mirrors
--    gateway.connection_usable_by_customer exactly in spirit. Also re-checks
--    the repository is still allowed/present and its installation active,
--    the same facts github_bind_task_repository itself already requires, so
--    a revoked allowlist entry or a disconnected installation refuses here
--    too, not only at bind time.
-- ---------------------------------------------------------------------------
create or replace function gateway.github_repository_usable_by_customer(p_repository_id uuid, p_customer_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.github_repositories r
    join public.github_installations gi on gi.id = r.installation_row_id and gi.tenant_id = r.tenant_id
    join public.github_repository_customer_delegations d
      on d.repository_id = r.id and d.customer_id = p_customer_id and d.revoked_at is null
    where r.id = p_repository_id
      and r.allowed and r.present and gi.status = 'active'
  );
$$;
revoke all on function gateway.github_repository_usable_by_customer(uuid, uuid) from public;
grant execute on function gateway.github_repository_usable_by_customer(uuid, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 4. Shared core: the exact body of the pre-existing
--    public.github_bind_task_repository, with the actor principal taken as
--    an explicit parameter instead of resolved from auth.uid() internally.
-- ---------------------------------------------------------------------------
create or replace function gateway.github_bind_task_repository_core(
  p_tenant_id uuid, p_actor_principal_id uuid, p_task_id uuid, p_repository_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_task_status public.task_status;
begin
  select t.status into v_task_status from public.tasks t where t.id = p_task_id and t.tenant_id = p_tenant_id;
  if v_task_status is null then return 'task_not_found'; end if;
  if v_task_status in ('completed', 'terminated', 'failed') then return 'task_closed'; end if;
  if not exists (
    select 1 from public.github_repositories r
    join public.github_installations gi on gi.id = r.installation_row_id and gi.tenant_id = r.tenant_id
    where r.id = p_repository_id and r.tenant_id = p_tenant_id and r.allowed and r.present and gi.status = 'active'
  ) then return 'repository_not_allowed'; end if;
  if exists (select 1 from public.task_repository_bindings b where b.task_id = p_task_id) then return 'already_bound'; end if;
  insert into public.task_repository_bindings (tenant_id, task_id, repository_id, bound_by_principal_id)
  values (p_tenant_id, p_task_id, p_repository_id, p_actor_principal_id);
  return 'ok';
end;
$fn$;
revoke all on function gateway.github_bind_task_repository_core(uuid, uuid, uuid, uuid) from public;

-- public.github_bind_task_repository: same signature, same auth.uid() gate,
-- byte-identical behavior -- now delegating to the shared core above.
create or replace function public.github_bind_task_repository(
  p_tenant_id uuid, p_user_id uuid, p_task_id uuid, p_repository_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_principal uuid;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'developer') then return 'forbidden'; end if;
  v_principal := gateway.actor_principal(p_tenant_id, p_user_id);
  if v_principal is null then return 'forbidden'; end if;
  return gateway.github_bind_task_repository_core(p_tenant_id, v_principal, p_task_id, p_repository_id);
end;
$fn$;
revoke all on function public.github_bind_task_repository(uuid, uuid, uuid, uuid) from public;
grant execute on function public.github_bind_task_repository(uuid, uuid, uuid, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 5. Backend-credential-facing surface.
-- ---------------------------------------------------------------------------

-- Every repository delegated to this customer (and still allowed/present,
-- installation active) -- the discovery step before binding one to a task.
-- Guarantees an 'ok' row even with zero matches (see
-- 20261003000013_fix_list_customer_connections_empty_result.sql's own
-- fix for the identical bug in the connections equivalent).
create or replace function gateway.list_customer_github_repositories_for_backend(p_secret text, p_customer_id uuid)
returns table (
  lcgr_status text, lcgr_repository_id uuid, lcgr_owner text, lcgr_name text,
  lcgr_default_branch text, lcgr_is_private boolean
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid;
  v_customer_tenant uuid; v_customer_app uuid;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::text, null::text, null::text, null::boolean; return;
  end if;

  select tenant_id, application_id into v_customer_tenant, v_customer_app
  from public.customers where id = p_customer_id;
  if v_customer_tenant is null or v_customer_tenant <> v_tenant or v_customer_app <> v_app then
    return query select 'customer_not_found'::text, null::uuid, null::text, null::text, null::text, null::boolean;
    return;
  end if;

  return query
    select 'ok'::text, r.id, r.owner, r.name, r.default_branch, r.is_private
    from public.github_repositories r
    join public.github_installations gi on gi.id = r.installation_row_id and gi.tenant_id = r.tenant_id
    join public.github_repository_customer_delegations d
      on d.repository_id = r.id and d.customer_id = p_customer_id and d.revoked_at is null
    where r.tenant_id = v_tenant and r.allowed and r.present and gi.status = 'active'
    union all
    select 'ok'::text, null::uuid, null::text, null::text, null::text, null::boolean
    where not exists (
      select 1
      from public.github_repositories r2
      join public.github_installations gi2 on gi2.id = r2.installation_row_id and gi2.tenant_id = r2.tenant_id
      join public.github_repository_customer_delegations d2
        on d2.repository_id = r2.id and d2.customer_id = p_customer_id and d2.revoked_at is null
      where r2.tenant_id = v_tenant and r2.allowed and r2.present and gi2.status = 'active'
    );
end;
$fn$;
revoke all on function gateway.list_customer_github_repositories_for_backend(text, uuid) from public;
grant execute on function gateway.list_customer_github_repositories_for_backend(text, uuid) to authority_gateway;

-- The write: binds a task to a repository delegated to that task's own
-- customer. Every other invariant (task open, repository allowed, not
-- already bound) is enforced by the same core the dashboard path uses.
create or replace function gateway.github_bind_task_repository_for_backend(
  p_secret text, p_task_id uuid, p_repository_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid;
  v_task_status text; v_task_tenant uuid; v_task_intent text; v_task_customer uuid;
  v_activator_principal_id uuid;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then return v_status; end if;

  select gtb_status, gtb_tenant_id, gtb_intent, gtb_customer_id
    into v_task_status, v_task_tenant, v_task_intent, v_task_customer
  from gateway.get_task_for_backend(p_secret, p_task_id);
  if v_task_status <> 'ok' then return v_task_status; end if;

  if not gateway.github_repository_usable_by_customer(p_repository_id, v_task_customer) then
    return 'repository_not_usable_by_customer';
  end if;

  v_activator_principal_id := gateway.ensure_application_service_principal(v_tenant, v_app);
  return gateway.github_bind_task_repository_core(v_tenant, v_activator_principal_id, p_task_id, p_repository_id);
end;
$fn$;
revoke all on function gateway.github_bind_task_repository_for_backend(text, uuid, uuid) from public;
grant execute on function gateway.github_bind_task_repository_for_backend(text, uuid, uuid) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000015'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
