-- Embedded customer connections, part 8: finishing Mode A for a connector
-- whose OAuth exchange already happened in application code (Gmail's own
-- oauth.ts, reused as-is). There is no dashboard admin session behind this
-- call -- Alex authorized Google directly, with no Authority credential at
-- any point -- so this cannot go through gateway.set_connector_secret(),
-- which requires a real p_user_id and checks actor_meets_role(). Authority
-- here instead of a human admin: the connection session's own token, single-
-- use and already bound to one tenant/application/customer/connector by
-- gateway.create_connection_session(). Resolving it is the authorization.

create or replace function gateway.complete_embedded_connection(
  p_session_token text,
  p_secret_type text,
  p_plaintext_secret text,
  p_verified_account_ref text,
  p_config jsonb
)
returns table (cec_status text, cec_connection_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_hash text;
  v_session record;
  v_connection_id uuid;
  v_vault_id uuid;
  v_complete_status text;
  v_was_existing boolean := false;
begin
  if p_secret_type not in ('bearer_token', 'api_key', 'basic_username', 'basic_password', 'oauth_refresh_token') then
    raise exception 'unknown secret type' using errcode = '22023';
  end if;
  if p_plaintext_secret is null or char_length(p_plaintext_secret) not between 1 and 8192 then
    raise exception 'secret must be 1-8192 characters' using errcode = '22023';
  end if;
  if p_verified_account_ref is null or char_length(btrim(p_verified_account_ref)) < 1
     or char_length(p_verified_account_ref) > 200 then
    raise exception 'a verified account reference is required' using errcode = '22023';
  end if;

  if p_session_token is null or left(p_session_token, 13) <> 'authority_cs_' then
    return query select 'not_found'::text, null::uuid; return;
  end if;
  v_hash := encode(extensions.digest(p_session_token, 'sha256'), 'hex');
  select * into v_session from public.connection_sessions where token_hash = v_hash;
  if v_session.id is null or v_session.status <> 'pending' or v_session.expires_at <= now() then
    return query select 'not_found'::text, null::uuid; return;
  end if;

  -- Reconnecting the same already-verified account (e.g. after a revoked
  -- grant, or a repeated callback) updates that connection's credential and
  -- bumps its config generation, exactly like gateway.set_connector_secret's
  -- own rotation path -- it never creates a second row that would collide
  -- with connector_connections_one_per_owner_account.
  select id into v_connection_id
  from public.connector_connections
  where tenant_id = v_session.tenant_id and connector_id = v_session.connector_id
    and owner_kind = 'customer' and owner_customer_id = v_session.customer_id
    and verified_account_ref = btrim(p_verified_account_ref) and status <> 'disconnected';

  if v_connection_id is not null then
    v_was_existing := true;
    update public.connector_connections
      set status = 'active', config = coalesce(p_config, '{}'::jsonb), config_version = config_version + 1
      where id = v_connection_id;
  else
    insert into public.connector_connections (
      tenant_id, connector_id, name, owner_kind, owner_customer_id, verified_account_ref, status, config
    ) values (
      v_session.tenant_id, v_session.connector_id, 'Embedded connection', 'customer', v_session.customer_id,
      btrim(p_verified_account_ref), 'active', coalesce(p_config, '{}'::jsonb)
    )
    returning id into v_connection_id;
  end if;

  select vault_secret_id into v_vault_id
  from public.connector_connection_secrets where connection_id = v_connection_id and secret_type = p_secret_type;

  if v_vault_id is not null then
    perform vault.update_secret(v_vault_id, p_plaintext_secret);
    update public.connector_connection_secrets set rotated_at = now()
      where connection_id = v_connection_id and secret_type = p_secret_type;
  else
    v_vault_id := vault.create_secret(
      p_plaintext_secret, v_connection_id::text || ':' || p_secret_type, 'Authority embedded connector credential'
    );
    insert into public.connector_connection_secrets (tenant_id, connection_id, secret_type, vault_secret_id)
    values (v_session.tenant_id, v_connection_id, p_secret_type, v_vault_id);
  end if;

  select gateway.complete_connection_session(p_session_token, v_connection_id) into v_complete_status;
  if v_complete_status <> 'ok' then
    -- Session was resolved and raced to completion (or expired) between the
    -- check above and here. Only disconnect a connection this call just
    -- created -- a reused, already-live connection from a prior successful
    -- connect must never be torn down just because a duplicate callback
    -- lost this race.
    if not v_was_existing then
      update public.connector_connections set status = 'disconnected', disconnected_at = now()
      where id = v_connection_id;
    end if;
    return query select 'session_already_resolved'::text, null::uuid; return;
  end if;

  return query select 'ok'::text, v_connection_id;
end;
$fn$;
revoke all on function gateway.complete_embedded_connection(text, text, text, text, jsonb) from public;
grant execute on function gateway.complete_embedded_connection(text, text, text, text, jsonb) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000008'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
