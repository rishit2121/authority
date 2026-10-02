-- Adds "oauth_refresh_token" to the set of recognized connector secret
-- types, for the Gmail connector (Phase 7 of the agent-integration
-- roadmap): unlike Stripe/Slack's single static bearer/API-key credential,
-- Gmail's API requires a standard OAuth2 authorization-code flow, and the
-- one long-lived artifact worth persisting from that flow is the refresh
-- token -- a short-lived access token is derived from it fresh on every
-- execution (see src/lib/connectors/gmail/oauth.ts), never stored.
--
-- Postgres names an unnamed inline column CHECK constraint
-- "<table>_<column>_check" by default; that is the constraint being
-- replaced here (added as such in 20261001000006_connector_secrets.sql).
alter table public.connector_connection_secrets
  drop constraint connector_connection_secrets_secret_type_check;
alter table public.connector_connection_secrets
  add constraint connector_connection_secrets_secret_type_check
  check (secret_type in ('bearer_token', 'api_key', 'basic_username', 'basic_password', 'oauth_refresh_token'));

create or replace function gateway.set_connector_secret(
  p_tenant_id uuid, p_user_id uuid, p_connection_id uuid, p_secret_type text, p_plaintext_secret text
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_exists boolean;
  v_existing_vault_id uuid;
  v_new_vault_id uuid;
  v_principal uuid;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'admin') then return 'forbidden'; end if;
  if p_secret_type not in ('bearer_token', 'api_key', 'basic_username', 'basic_password', 'oauth_refresh_token') then
    raise exception 'unknown secret type' using errcode = '22023';
  end if;
  if p_plaintext_secret is null or char_length(p_plaintext_secret) not between 1 and 8192 then
    raise exception 'secret must be 1-8192 characters' using errcode = '22023';
  end if;
  select exists(select 1 from public.connector_connections where id = p_connection_id and tenant_id = p_tenant_id and status <> 'disconnected')
    into v_exists;
  if not v_exists then return 'connection_not_found'; end if;

  v_principal := gateway.actor_principal(p_tenant_id, p_user_id);
  select vault_secret_id into v_existing_vault_id
  from public.connector_connection_secrets where connection_id = p_connection_id and secret_type = p_secret_type;

  if v_existing_vault_id is not null then
    perform vault.update_secret(v_existing_vault_id, p_plaintext_secret);
    update public.connector_connection_secrets
      set rotated_at = now(), rotated_by_principal_id = v_principal
      where connection_id = p_connection_id and secret_type = p_secret_type;
  else
    v_new_vault_id := vault.create_secret(p_plaintext_secret, p_connection_id::text || ':' || p_secret_type, 'Authority connector credential');
    insert into public.connector_connection_secrets (tenant_id, connection_id, secret_type, vault_secret_id, created_by_principal_id)
    values (p_tenant_id, p_connection_id, p_secret_type, v_new_vault_id, v_principal);
  end if;

  update public.connector_connections set config_version = config_version + 1 where id = p_connection_id;
  return 'ok';
end;
$fn$;
revoke all on function gateway.set_connector_secret(uuid, uuid, uuid, text, text) from public;
grant execute on function gateway.set_connector_secret(uuid, uuid, uuid, text, text) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261001000012'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
