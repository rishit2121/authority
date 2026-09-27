-- Part 7: revoking a tenant's GitHub capabilities (disconnect / uninstall) also returns
-- their unused budget to the contract.

create or replace function gateway.revoke_tenant_github_capabilities(p_tenant_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_n integer := 0;
begin
  for v_id in
    select ct.id from public.capability_tokens ct
    where ct.tenant_id = p_tenant_id and ct.status = 'active' and ct.tool like 'github.%' order by ct.id
  loop
    perform pg_advisory_xact_lock(hashtextextended('authority.capability:' || v_id::text, 0));
    update public.capability_tokens
      set status = 'revoked', revoked_at = now(), revoked_by = 'system', revocation_reason = p_reason
      where id = v_id and status = 'active';
    perform gateway.release_unused_budget(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;
revoke all on function gateway.revoke_tenant_github_capabilities(uuid, text) from public;
grant execute on function gateway.revoke_tenant_github_capabilities(uuid, text) to authority_gateway;

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

  v_revoked := gateway.revoke_tenant_github_capabilities(p_tenant_id, 'GitHub installation disconnected');
  return query select 'ok'::text, v_gh_id, v_revoked;
end;
$fn$;
revoke all on function gateway.github_disconnect(uuid, uuid, uuid) from public;
grant execute on function gateway.github_disconnect(uuid, uuid, uuid) to authority_gateway;

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
    perform gateway.revoke_tenant_github_capabilities(v_tenant, 'GitHub installation deleted');
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
