-- Connector credential storage, using Supabase Vault (pgsodium-backed
-- encryption at rest) rather than a hand-rolled encryption scheme, per
-- Phase 3 of the agent-integration roadmap: "Use the existing reviewed
-- server-only secret mechanism or Supabase Vault."
--
-- This table never stores a secret value, only a reference to a row in
-- vault.secrets. `authority_gateway` itself has no grant on the vault schema
-- at all (confirmed: vault.decrypted_secrets is grantable only to postgres/
-- service_role) — every function below is `security definer`, so it runs as
-- its owning role (postgres, the migration-applying role), exactly the same
-- privilege-separation pattern every other gateway.* function in this schema
-- already uses. No service-role key is introduced anywhere in the app.
--
-- A secret's plaintext is readable only inside gateway.resolve_connector_secret,
-- called exclusively from server-side connector execution code using the
-- gateway's own pooled connection — never returned by any client-facing RPC,
-- never logged.

create table public.connector_connection_secrets (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  connection_id   uuid not null,
  secret_type     text not null check (secret_type in ('bearer_token', 'api_key', 'basic_username', 'basic_password')),
  vault_secret_id uuid not null,
  created_by_principal_id uuid,
  created_at      timestamptz not null default now(),
  rotated_at      timestamptz,
  rotated_by_principal_id uuid,
  unique (id, tenant_id),
  unique (connection_id, secret_type),
  foreign key (connection_id, tenant_id) references public.connector_connections (id, tenant_id),
  foreign key (created_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  foreign key (rotated_by_principal_id, tenant_id) references public.principals (id, tenant_id)
);
create index connector_connection_secrets_connection_idx on public.connector_connection_secrets (connection_id);

alter table public.connector_connection_secrets enable row level security;
revoke all on public.connector_connection_secrets from public, anon, authenticated;
-- Metadata only (never vault_secret_id) -- "Configured since <date>" /
-- "Last rotated <date>", never the secret or even which vault row holds it.
grant select (id, tenant_id, connection_id, secret_type, created_at, rotated_at) on public.connector_connection_secrets to authenticated;
create policy "connector_connection_secrets_select_within_tenant" on public.connector_connection_secrets
  for select to authenticated using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- Set/rotate a secret. Admin+ only -- "Only authorized integration
-- administrators may configure connections." Bumps the connection's
-- config_version so capabilities/reservations bound to the OLD credential
-- generation are visibly stamped as such in their own receipts, even though
-- (per this schema's design) a reservation only pins the connection id, not
-- a specific secret generation -- rotating a secret takes effect on the next
-- call under the same connection, same as rotating any other live credential.
-- ---------------------------------------------------------------------------
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
  if p_secret_type not in ('bearer_token', 'api_key', 'basic_username', 'basic_password') then
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

-- Server-only, never agent- or UI-reachable: resolves the plaintext for
-- execution. Takes no human actor at all, by design -- only the generic
-- connector executor calls this, with a connection id it already resolved
-- and verified (task/tenant/capability bound) via reserve_connector_execution.
create or replace function gateway.resolve_connector_secret(p_connection_id uuid, p_secret_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_plaintext text;
begin
  select vs.decrypted_secret into v_plaintext
  from public.connector_connection_secrets ccs
  join vault.decrypted_secrets vs on vs.id = ccs.vault_secret_id
  where ccs.connection_id = p_connection_id and ccs.secret_type = p_secret_type;
  return v_plaintext;
end;
$fn$;
revoke all on function gateway.resolve_connector_secret(uuid, text) from public;
grant execute on function gateway.resolve_connector_secret(uuid, text) to authority_gateway;

create or replace function gateway.has_connector_secret(p_connection_id uuid, p_secret_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.connector_connection_secrets where connection_id = p_connection_id and secret_type = p_secret_type);
$$;
revoke all on function gateway.has_connector_secret(uuid, text) from public;
grant execute on function gateway.has_connector_secret(uuid, text) to authority_gateway;
