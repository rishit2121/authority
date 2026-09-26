-- Part 7: installation-flow gateway functions.
--
-- Trust: these run as the restricted `authority_gateway` role, callable only by
-- the server. The web server authenticates the human (Supabase session) and
-- passes that user's id; every function re-derives the user's tenant role from
-- tenant_memberships itself, so the caller cannot claim a role it does not
-- hold. A NULL actor means a system caller (webhook processing) and is
-- accepted only by the functions that document it.

-- Webhook replay protection: one row per GitHub delivery id.
create table public.github_webhook_deliveries (
  delivery_id text primary key check (delivery_id ~ '^[A-Za-z0-9-]{8,80}$'),
  event       text not null check (event ~ '^[a-z_]{1,60}$'),
  action      text check (action is null or action ~ '^[a-z_]{1,60}$'),
  github_installation_id bigint,
  outcome     text not null check (outcome in ('applied', 'ignored_unknown_installation', 'ignored_unsupported')),
  received_at timestamptz not null default now()
);
create trigger github_webhook_deliveries_append_only
  before update or delete on public.github_webhook_deliveries
  for each row execute function authz.forbid_update_delete();
alter table public.github_webhook_deliveries enable row level security;
revoke all on public.github_webhook_deliveries from public, anon, authenticated;

create or replace function gateway.actor_meets_role(p_tenant_id uuid, p_user_id uuid, p_min_role public.tenant_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select authz.role_rank(m.role) >= authz.role_rank(p_min_role)
    from public.tenant_memberships m
    where m.tenant_id = p_tenant_id and m.user_id = p_user_id
  ), false);
$$;
revoke all on function gateway.actor_meets_role(uuid, uuid, public.tenant_role) from public;
grant execute on function gateway.actor_meets_role(uuid, uuid, public.tenant_role) to authority_gateway;

create or replace function gateway.actor_principal(p_tenant_id uuid, p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.principals p where p.tenant_id = p_tenant_id and p.user_id = p_user_id limit 1;
$$;
revoke all on function gateway.actor_principal(uuid, uuid) from public;
grant execute on function gateway.actor_principal(uuid, uuid) to authority_gateway;

-- Recompute installation health from GitHub-reported facts. Extra permissions
-- (over-privilege) and missing/downgraded ones are both drift; a suspended
-- installation stays suspended. Expected permissions come from the caller (the
-- code's declared least-privilege set) and are never persisted as trust.
create or replace function gateway.github_health(p_granted jsonb, p_expected jsonb, p_suspended boolean)
returns table (h_status text, h_reasons text[])
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_reasons text[] := '{}'::text[];
  k text;
  v text;
begin
  for k, v in select e.key, e.value #>> '{}' from jsonb_each(coalesce(p_granted, '{}'::jsonb)) e loop
    if not (p_expected ? k) then
      v_reasons := v_reasons || ('PERMISSION_EXTRA:' || k);
    elsif (case v when 'read' then 1 when 'write' then 2 when 'admin' then 3 else 9 end)
        > (case p_expected ->> k when 'read' then 1 when 'write' then 2 when 'admin' then 3 else 0 end) then
      v_reasons := v_reasons || ('PERMISSION_EXCESS:' || k);
    end if;
  end loop;
  for k, v in select e.key, e.value #>> '{}' from jsonb_each(coalesce(p_expected, '{}'::jsonb)) e loop
    if not (coalesce(p_granted, '{}'::jsonb) ? k)
       or (case p_granted ->> k when 'read' then 1 when 'write' then 2 when 'admin' then 3 else 0 end)
          < (case v when 'read' then 1 when 'write' then 2 when 'admin' then 3 else 9 end) then
      v_reasons := v_reasons || ('PERMISSION_MISSING:' || k);
    end if;
  end loop;
  return query select case when p_suspended then 'suspended'
                           when cardinality(v_reasons) > 0 then 'permission_drift'
                           else 'active' end, v_reasons;
end;
$$;
revoke all on function gateway.github_health(jsonb, jsonb, boolean) from public;
grant execute on function gateway.github_health(jsonb, jsonb, boolean) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 1. Begin an installation: an admin gets a single-use state nonce.
-- ---------------------------------------------------------------------------
create or replace function gateway.github_begin_install(p_tenant_id uuid, p_user_id uuid, p_nonce_hash text)
returns table (b_status text, b_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_principal uuid;
  v_expires timestamptz := now() + interval '15 minutes';
begin
  if p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'malformed state nonce' using errcode = '22023';
  end if;
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'admin') then
    return query select 'forbidden'::text, null::timestamptz;
    return;
  end if;
  if exists (select 1 from public.github_installations gi where gi.tenant_id = p_tenant_id and gi.status <> 'disconnected') then
    return query select 'already_connected'::text, null::timestamptz;
    return;
  end if;
  v_principal := gateway.actor_principal(p_tenant_id, p_user_id);
  if v_principal is null then
    return query select 'forbidden'::text, null::timestamptz;
    return;
  end if;
  -- Bound the outstanding states one user can pile up.
  if (select count(*) from public.github_install_states s
        where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.status = 'issued' and s.expires_at > now()) >= 10 then
    return query select 'rate_limited'::text, null::timestamptz;
    return;
  end if;
  insert into public.github_install_states (tenant_id, user_id, principal_id, nonce_hash, expires_at)
  values (p_tenant_id, p_user_id, v_principal, p_nonce_hash, v_expires);
  return query select 'ok'::text, v_expires;
end;
$fn$;
revoke all on function gateway.github_begin_install(uuid, uuid, text) from public;
grant execute on function gateway.github_begin_install(uuid, uuid, text) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 2. GitHub redirected the browser back with an installation id. It is only a
--    CLAIM until the user proves (via GitHub OAuth) that they can see it.
--    The nonce must belong to this exact user and tenant, be unexpired, and be
--    unused; a claim on an installation another tenant owns is refused.
-- ---------------------------------------------------------------------------
create or replace function gateway.github_report_install(
  p_tenant_id uuid, p_user_id uuid, p_nonce_hash text, p_installation_id bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_state_id uuid;
  v_status text;
begin
  if p_installation_id is null or p_installation_id <= 0 then return 'invalid_installation'; end if;
  select s.id, s.status into v_state_id, v_status
  from public.github_install_states s
  where s.nonce_hash = p_nonce_hash and s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.expires_at > now()
  for update;
  if v_state_id is null then return 'invalid_state'; end if;
  if v_status <> 'issued' then return 'state_already_used'; end if;
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'admin') then return 'forbidden'; end if;
  if exists (select 1 from public.github_installations gi
             where gi.github_installation_id = p_installation_id and gi.tenant_id <> p_tenant_id) then
    update public.github_install_states set status = 'rejected', reject_reason = 'INSTALLATION_UNAVAILABLE' where id = v_state_id;
    return 'installation_unavailable';
  end if;
  update public.github_install_states
    set status = 'installation_reported', reported_installation_id = p_installation_id
    where id = v_state_id;
  return 'ok';
end;
$fn$;
revoke all on function gateway.github_report_install(uuid, uuid, text, bigint) from public;
grant execute on function gateway.github_report_install(uuid, uuid, text, bigint) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 3. Complete: after the server verified (App JWT + user-to-server token) that
--    this user can see this installation and read its permissions from GitHub.
-- ---------------------------------------------------------------------------
create or replace function gateway.github_complete_install(
  p_tenant_id uuid, p_user_id uuid, p_nonce_hash text, p_installation_id bigint,
  p_account_login text, p_account_type text, p_github_account_id bigint, p_selection text,
  p_permissions jsonb, p_events text[], p_expected_permissions jsonb, p_mode text
)
returns table (c_status text, c_installation_row_id uuid, c_health text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_state_id uuid;
  v_status text;
  v_reported bigint;
  v_principal uuid;
  v_row uuid;
  v_health text;
  v_reasons text[];
  v_existing_tenant uuid;
  v_existing_status text;
begin
  select s.id, s.status, s.reported_installation_id into v_state_id, v_status, v_reported
  from public.github_install_states s
  where s.nonce_hash = p_nonce_hash and s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.expires_at > now()
  for update;
  if v_state_id is null then
    return query select 'invalid_state'::text, null::uuid, null::text; return;
  end if;
  if v_status <> 'installation_reported' or v_reported is distinct from p_installation_id then
    return query select 'state_mismatch'::text, null::uuid, null::text; return;
  end if;
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'admin') then
    return query select 'forbidden'::text, null::uuid, null::text; return;
  end if;
  v_principal := gateway.actor_principal(p_tenant_id, p_user_id);

  select gi.tenant_id, gi.status into v_existing_tenant, v_existing_status
  from public.github_installations gi where gi.github_installation_id = p_installation_id;
  if v_existing_tenant is not null and v_existing_tenant <> p_tenant_id then
    update public.github_install_states set status = 'rejected', reject_reason = 'INSTALLATION_UNAVAILABLE' where id = v_state_id;
    return query select 'installation_unavailable'::text, null::uuid, null::text; return;
  end if;
  if exists (select 1 from public.github_installations gi
             where gi.tenant_id = p_tenant_id and gi.status <> 'disconnected' and gi.github_installation_id <> p_installation_id) then
    return query select 'already_connected'::text, null::uuid, null::text; return;
  end if;

  select h.h_status, h.h_reasons into v_health, v_reasons from gateway.github_health(p_permissions, p_expected_permissions, false) h;

  if v_existing_tenant is null then
    insert into public.github_installations (
      tenant_id, github_installation_id, mode, account_login, account_type, github_account_id, repository_selection,
      granted_permissions, subscribed_events, status, health_reasons, last_verified_at, connected_by_principal_id
    ) values (
      p_tenant_id, p_installation_id, p_mode, p_account_login, p_account_type, p_github_account_id, p_selection,
      coalesce(p_permissions, '{}'::jsonb), coalesce(p_events, '{}'::text[]), v_health, v_reasons, now(), v_principal
    ) returning id into v_row;
  else
    -- Reconnecting this tenant's own earlier (disconnected) installation.
    update public.github_installations
      set mode = p_mode, account_login = p_account_login, account_type = p_account_type, github_account_id = p_github_account_id,
          repository_selection = p_selection, granted_permissions = coalesce(p_permissions, '{}'::jsonb),
          subscribed_events = coalesce(p_events, '{}'::text[]), status = v_health, health_reasons = v_reasons,
          last_verified_at = now(), connected_by_principal_id = v_principal, connected_at = now(),
          disconnected_at = null, disconnected_by_principal_id = null, suspended_at = null
      where github_installation_id = p_installation_id and tenant_id = p_tenant_id
      returning id into v_row;
  end if;

  update public.github_install_states set status = 'completed', completed_at = now() where id = v_state_id;
  return query select 'ok'::text, v_row, v_health;
end;
$fn$;
revoke all on function gateway.github_complete_install(uuid, uuid, text, bigint, text, text, bigint, text, jsonb, text[], jsonb, text) from public;
grant execute on function gateway.github_complete_install(uuid, uuid, text, bigint, text, text, bigint, text, jsonb, text[], jsonb, text) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 4. Repository snapshot from GitHub (the installation's own repository list).
--    New repositories arrive NOT allowed; repositories that left the
--    installation are marked absent and lose their allowlist entry.
-- ---------------------------------------------------------------------------
create or replace function gateway.github_apply_repository_snapshot(
  p_tenant_id uuid, p_actor_user_id uuid, p_installation_row_id uuid, p_repos jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item jsonb;
  v_ids bigint[] := '{}'::bigint[];
  v_n integer;
begin
  if p_actor_user_id is not null and not gateway.actor_meets_role(p_tenant_id, p_actor_user_id, 'admin') then
    return 'forbidden';
  end if;
  if not exists (select 1 from public.github_installations gi
                 where gi.id = p_installation_row_id and gi.tenant_id = p_tenant_id and gi.status <> 'disconnected') then
    return 'installation_unavailable';
  end if;
  if p_repos is null or jsonb_typeof(p_repos) <> 'array' or jsonb_array_length(p_repos) > 500 then
    raise exception 'repository snapshot must be an array of at most 500 entries' using errcode = '22023';
  end if;

  for v_item in select e.value from jsonb_array_elements(p_repos) e loop
    insert into public.github_repositories (
      tenant_id, installation_row_id, github_repository_id, owner, name, default_branch, is_private, archived, present
    ) values (
      p_tenant_id, p_installation_row_id, (v_item ->> 'id')::bigint, v_item ->> 'owner', v_item ->> 'name',
      v_item ->> 'defaultBranch', coalesce((v_item ->> 'private')::boolean, true),
      coalesce((v_item ->> 'archived')::boolean, false), true
    )
    on conflict (installation_row_id, github_repository_id) do update
      set owner = excluded.owner, name = excluded.name, default_branch = excluded.default_branch,
          is_private = excluded.is_private, archived = excluded.archived, present = true,
          -- A repository that was renamed or transferred keeps its identity but
          -- must be re-approved: the allowlist follows the immutable numeric id
          -- only while the name is unchanged.
          allowed = case when lower(public.github_repositories.owner || '/' || public.github_repositories.name)
                            = lower(excluded.owner || '/' || excluded.name)
                          and not excluded.archived then public.github_repositories.allowed else false end,
          allowed_at = case when lower(public.github_repositories.owner || '/' || public.github_repositories.name)
                            = lower(excluded.owner || '/' || excluded.name)
                          and not excluded.archived then public.github_repositories.allowed_at else null end;
    v_ids := v_ids || (v_item ->> 'id')::bigint;
  end loop;

  update public.github_repositories
    set present = false, allowed = false, allowed_at = null
    where installation_row_id = p_installation_row_id and tenant_id = p_tenant_id
      and github_repository_id <> all (v_ids) and (present or allowed);
  get diagnostics v_n = row_count;
  return 'ok';
end;
$fn$;
revoke all on function gateway.github_apply_repository_snapshot(uuid, uuid, uuid, jsonb) from public;
grant execute on function gateway.github_apply_repository_snapshot(uuid, uuid, uuid, jsonb) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 5. Explicit repository allowlist.
-- ---------------------------------------------------------------------------
create or replace function gateway.github_set_repository_allowed(
  p_tenant_id uuid, p_user_id uuid, p_repository_id uuid, p_allowed boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_principal uuid;
  v_present boolean;
  v_archived boolean;
  v_inst_status text;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'admin') then return 'forbidden'; end if;
  select r.present, r.archived, gi.status into v_present, v_archived, v_inst_status
  from public.github_repositories r
  join public.github_installations gi on gi.id = r.installation_row_id and gi.tenant_id = r.tenant_id
  where r.id = p_repository_id and r.tenant_id = p_tenant_id;
  if v_present is null then return 'not_found'; end if;
  if p_allowed and (not v_present or v_archived or v_inst_status <> 'active') then return 'not_allowable'; end if;
  v_principal := gateway.actor_principal(p_tenant_id, p_user_id);
  update public.github_repositories
    set allowed = p_allowed,
        allowed_by_principal_id = case when p_allowed then v_principal else null end,
        allowed_at = case when p_allowed then now() else null end
    where id = p_repository_id and tenant_id = p_tenant_id;
  return 'ok';
end;
$fn$;
revoke all on function gateway.github_set_repository_allowed(uuid, uuid, uuid, boolean) from public;
grant execute on function gateway.github_set_repository_allowed(uuid, uuid, uuid, boolean) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 6. Task-to-repository binding (immutable once written).
-- ---------------------------------------------------------------------------
create or replace function gateway.github_bind_task_repository(
  p_tenant_id uuid, p_user_id uuid, p_task_id uuid, p_repository_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_principal uuid;
  v_task_status public.task_status;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'developer') then return 'forbidden'; end if;
  v_principal := gateway.actor_principal(p_tenant_id, p_user_id);
  if v_principal is null then return 'forbidden'; end if;
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
  values (p_tenant_id, p_task_id, p_repository_id, v_principal);
  return 'ok';
end;
$fn$;
revoke all on function gateway.github_bind_task_repository(uuid, uuid, uuid, uuid) from public;
grant execute on function gateway.github_bind_task_repository(uuid, uuid, uuid, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 7. Health refresh from GitHub-reported facts (drift detection). A system
--    caller (NULL actor) is allowed: the webhook path and the scheduled check.
-- ---------------------------------------------------------------------------
create or replace function gateway.github_update_health(
  p_github_installation_id bigint, p_actor_user_id uuid, p_selection text, p_permissions jsonb,
  p_events text[], p_suspended boolean, p_expected_permissions jsonb
)
returns table (u_status text, u_health text, u_reasons text[])
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant uuid;
  v_current text;
  v_health text;
  v_reasons text[];
begin
  select gi.tenant_id, gi.status into v_tenant, v_current
  from public.github_installations gi where gi.github_installation_id = p_github_installation_id;
  if v_tenant is null or v_current = 'disconnected' then
    return query select 'not_found'::text, null::text, null::text[]; return;
  end if;
  if p_actor_user_id is not null and not gateway.actor_meets_role(v_tenant, p_actor_user_id, 'developer') then
    return query select 'forbidden'::text, null::text, null::text[]; return;
  end if;
  select h.h_status, h.h_reasons into v_health, v_reasons
  from gateway.github_health(p_permissions, p_expected_permissions, p_suspended) h;
  update public.github_installations
    set repository_selection = p_selection, granted_permissions = coalesce(p_permissions, '{}'::jsonb),
        subscribed_events = coalesce(p_events, '{}'::text[]), status = v_health, health_reasons = v_reasons,
        last_verified_at = now(),
        suspended_at = case when p_suspended then coalesce(suspended_at, now()) else null end
    where github_installation_id = p_github_installation_id;
  return query select 'ok'::text, v_health, v_reasons;
end;
$fn$;
revoke all on function gateway.github_update_health(bigint, uuid, text, jsonb, text[], boolean, jsonb) from public;
grant execute on function gateway.github_update_health(bigint, uuid, text, jsonb, text[], boolean, jsonb) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 8. Disconnect: local revocation is immediate and independent of whether the
--    GitHub-side uninstall succeeds. Repos lose their allowlist entries, and
--    every live capability for this tenant's GitHub tools is revoked.
-- ---------------------------------------------------------------------------
create or replace function gateway.github_disconnect(p_tenant_id uuid, p_user_id uuid, p_installation_row_id uuid)
returns table (d_status text, d_github_installation_id bigint, d_revoked integer)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_principal uuid;
  v_gh_id bigint;
  v_status text;
  v_revoked integer := 0;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'admin') then
    return query select 'forbidden'::text, null::bigint, 0; return;
  end if;
  select gi.github_installation_id, gi.status into v_gh_id, v_status
  from public.github_installations gi where gi.id = p_installation_row_id and gi.tenant_id = p_tenant_id for update;
  if v_gh_id is null then return query select 'not_found'::text, null::bigint, 0; return; end if;
  if v_status = 'disconnected' then return query select 'already_disconnected'::text, v_gh_id, 0; return; end if;
  v_principal := gateway.actor_principal(p_tenant_id, p_user_id);

  update public.github_installations
    set status = 'disconnected', disconnected_at = now(), disconnected_by_principal_id = v_principal
    where id = p_installation_row_id;
  update public.github_repositories set allowed = false, allowed_at = null
    where installation_row_id = p_installation_row_id and tenant_id = p_tenant_id and allowed;

  update public.capability_tokens ct
    set status = 'revoked', revoked_at = now(), revoked_by = 'system', revocation_reason = 'GitHub installation disconnected'
    where ct.tenant_id = p_tenant_id and ct.status = 'active' and ct.tool like 'github.%';
  get diagnostics v_revoked = row_count;
  return query select 'ok'::text, v_gh_id, v_revoked;
end;
$fn$;
revoke all on function gateway.github_disconnect(uuid, uuid, uuid) from public;
grant execute on function gateway.github_disconnect(uuid, uuid, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 9. Webhook effects. Signature verification happens in the server BEFORE this
--    is called; the delivery id makes replays no-ops. Only a mapped
--    installation is ever touched.
-- ---------------------------------------------------------------------------
create or replace function gateway.github_apply_webhook(
  p_delivery_id text, p_event text, p_action text, p_github_installation_id bigint, p_removed_repository_ids bigint[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row uuid;
  v_tenant uuid;
  v_outcome text := 'applied';
begin
  if exists (select 1 from public.github_webhook_deliveries d where d.delivery_id = p_delivery_id) then
    return 'duplicate_delivery';
  end if;
  select gi.id, gi.tenant_id into v_row, v_tenant
  from public.github_installations gi where gi.github_installation_id = p_github_installation_id;

  if v_row is null then
    v_outcome := 'ignored_unknown_installation';
  elsif p_event = 'installation' and p_action = 'deleted' then
    update public.github_installations set status = 'disconnected', disconnected_at = coalesce(disconnected_at, now())
      where id = v_row and status <> 'disconnected';
    update public.github_repositories set allowed = false, allowed_at = null, present = false where installation_row_id = v_row;
    update public.capability_tokens ct
      set status = 'revoked', revoked_at = now(), revoked_by = 'system', revocation_reason = 'GitHub installation deleted'
      where ct.tenant_id = v_tenant and ct.status = 'active' and ct.tool like 'github.%';
  elsif p_event = 'installation' and p_action = 'suspend' then
    update public.github_installations set status = 'suspended', suspended_at = coalesce(suspended_at, now())
      where id = v_row and status <> 'disconnected';
  elsif p_event = 'installation' and p_action in ('unsuspend', 'new_permissions_accepted', 'created') then
    -- Never trusted directly: force a re-verification before the installation is usable again.
    update public.github_installations
      set status = 'permission_drift', health_reasons = array['NEEDS_REVERIFICATION'], last_verified_at = null, suspended_at = null
      where id = v_row and status <> 'disconnected';
  elsif p_event = 'installation_repositories' and p_action = 'removed' then
    update public.github_repositories set present = false, allowed = false, allowed_at = null
      where installation_row_id = v_row and github_repository_id = any (coalesce(p_removed_repository_ids, '{}'::bigint[]));
  elsif p_event = 'installation_repositories' and p_action = 'added' then
    update public.github_installations set health_reasons = array_append(
      array_remove(health_reasons, 'REPOSITORIES_CHANGED'), 'REPOSITORIES_CHANGED') where id = v_row;
  else
    v_outcome := 'ignored_unsupported';
  end if;

  insert into public.github_webhook_deliveries (delivery_id, event, action, github_installation_id, outcome)
  values (p_delivery_id, p_event, p_action, p_github_installation_id, v_outcome);
  return v_outcome;
end;
$fn$;
revoke all on function gateway.github_apply_webhook(text, text, text, bigint, bigint[]) from public;
grant execute on function gateway.github_apply_webhook(text, text, text, bigint, bigint[]) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 10. Read helper: the installation row id and GitHub id for a tenant's live
--     installation (the server needs the numeric id to mint tokens).
-- ---------------------------------------------------------------------------
create or replace function gateway.github_live_installation(p_tenant_id uuid, p_user_id uuid)
returns table (l_row_id uuid, l_github_installation_id bigint, l_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select gi.id, gi.github_installation_id, gi.status
  from public.github_installations gi
  where gi.tenant_id = p_tenant_id and gi.status <> 'disconnected'
    and gateway.actor_meets_role(p_tenant_id, p_user_id, 'viewer')
  limit 1;
$$;
revoke all on function gateway.github_live_installation(uuid, uuid) from public;
grant execute on function gateway.github_live_installation(uuid, uuid) to authority_gateway;
