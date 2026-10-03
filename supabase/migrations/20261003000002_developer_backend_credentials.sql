-- Embedded customer connections, part 2: developer backend credentials.
--
-- A new, third credential space -- deliberately not a reuse of
-- `agent_credentials`. An agent runtime key authenticates an *agent* calling
-- the authorize/execute surface on behalf of a task it's already been given.
-- A backend credential authenticates Acme's *own server*, calling an
-- entirely different surface: creating/resolving customers, opening
-- connection sessions, listing a customer's connections, and creating
-- customer-scoped tasks. These must never be the same secret or the same
-- resolution path -- a leaked agent key must not let an attacker mint new
-- customers or connections, and a leaked backend key must not let an
-- attacker authorize or execute a tool call. Mirrors agent_credentials'
-- storage shape exactly (SHA-256 of a 256-bit secret, prefix for audit
-- identification only, one-time plaintext display, explicit revocation).

create type public.backend_credential_status as enum ('active', 'revoked');

create table public.developer_backend_credentials (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  application_id uuid not null,
  environment public.tenant_environment not null default 'development',
  name        text check (name is null or char_length(btrim(name)) <= 200),
  -- "authority_dk_" + 8 lowercase-hex characters, the same audit-identifier
  -- convention as agent_credentials' key_prefix -- see that migration's own
  -- comment for why this doesn't narrow the secret's 256 bits of entropy.
  key_prefix  text not null check (key_prefix ~ '^authority_dk_[0-9a-f]{8}$'),
  key_hash    text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  status      public.backend_credential_status not null default 'active',
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  revoked_at  timestamptz,
  revoked_by  uuid references auth.users (id) on delete set null,
  revocation_reason text check (revocation_reason is null or char_length(revocation_reason) <= 2000),
  last_used_at timestamptz,
  unique (id, tenant_id),
  unique (key_hash),
  foreign key (application_id, tenant_id) references public.applications (id, tenant_id),
  check ((status = 'revoked') = (revoked_at is not null)),
  check (status = 'active' or revocation_reason is not null)
);

comment on table public.developer_backend_credentials is
  'Server-side-only secrets for a tenant''s own application backend to call '
  'the customer/connection/task-creation developer API. Distinct from '
  'agent_credentials (agent execution) and task_sessions (one task''s '
  'authorized window) -- never accepted on the authorize/execute surface, '
  'and the reverse. Only key_hash is stored; plaintext exists once, in '
  'create_backend_credential()''s return value.';

create index developer_backend_credentials_app_idx
  on public.developer_backend_credentials (application_id, status);

alter table public.developer_backend_credentials enable row level security;
revoke all on public.developer_backend_credentials from public, anon, authenticated;
-- Same sensitivity tier as agent_credentials: existence, prefix, and status
-- are visible only to security_admin+, never key_hash to any role.
create policy "developer_backend_credentials_select_by_security_admin_and_above"
  on public.developer_backend_credentials for select to authenticated
  using (authz.has_min_role(tenant_id, 'security_admin'));
grant select (
  id, tenant_id, application_id, environment, name, key_prefix, status,
  created_at, created_by, revoked_at, revoked_by, revocation_reason, last_used_at
) on public.developer_backend_credentials to authenticated;

-- ---------------------------------------------------------------------------
-- Issue / revoke, same shape as create_agent_credential / revoke_agent_credential
-- (20260927000005): dashboard-session RPCs, security definer, explicit role
-- checks rather than relying on RLS for the mutation itself.
-- ---------------------------------------------------------------------------
create or replace function public.create_backend_credential(p_application_id uuid, p_name text)
returns table (credential_id uuid, key_prefix text, plaintext_secret text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_secret_body text;
  v_plaintext text;
  v_prefix text;
  v_hash text;
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'create_backend_credential() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.applications where id = p_application_id;
  if v_tenant_id is null then
    raise exception 'application not found' using errcode = 'P0002';
  end if;

  if not authz.has_min_role(v_tenant_id, 'admin') then
    raise exception 'insufficient privileges to issue a backend credential for this application' using errcode = '42501';
  end if;

  v_secret_body := encode(extensions.gen_random_bytes(32), 'hex');
  v_plaintext := 'authority_dk_' || v_secret_body;
  v_prefix := left(v_plaintext, 21);
  v_hash := encode(extensions.digest(v_plaintext, 'sha256'), 'hex');

  insert into public.developer_backend_credentials (tenant_id, application_id, name, key_prefix, key_hash, created_by)
  values (v_tenant_id, p_application_id, nullif(btrim(coalesce(p_name, '')), ''), v_prefix, v_hash, (select auth.uid()))
  returning id into v_id;

  return query select v_id, v_prefix, v_plaintext;
end;
$fn$;
revoke all on function public.create_backend_credential(uuid, text) from public, anon;
grant execute on function public.create_backend_credential(uuid, text) to authenticated;

create or replace function public.revoke_backend_credential(p_credential_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_status public.backend_credential_status;
begin
  if (select auth.uid()) is null then
    raise exception 'revoke_backend_credential() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id, status into v_tenant_id, v_status
  from public.developer_backend_credentials where id = p_credential_id;
  if v_tenant_id is null then
    raise exception 'credential not found' using errcode = 'P0002';
  end if;

  if not authz.has_min_role(v_tenant_id, 'security_admin') then
    raise exception 'insufficient privileges to revoke this credential' using errcode = '42501';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) < 1 then
    raise exception 'a revocation reason is required' using errcode = '22023';
  end if;

  if v_status = 'revoked' then
    return;
  end if;

  update public.developer_backend_credentials
  set status = 'revoked', revoked_at = now(), revoked_by = (select auth.uid()),
      revocation_reason = btrim(p_reason)
  where id = p_credential_id;
end;
$fn$;
revoke all on function public.revoke_backend_credential(uuid, text) from public, anon;
grant execute on function public.revoke_backend_credential(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The gateway-side resolver every developer-API RPC below calls -- the
-- backend-credential analog of gateway.resolve_credential, but an entirely
-- separate function over an entirely separate table, so an agent runtime key
-- or task session is structurally incapable of resolving here, and vice
-- versa. Returns application_id, not just tenant_id: every developer-API
-- call is scoped to one application, never "the whole tenant," so a backend
-- credential from Acme's "Web" application can never see or touch "Acme
-- Mobile"'s customers even though both share a tenant.
-- ---------------------------------------------------------------------------
create or replace function gateway.resolve_backend_credential(p_secret text)
returns table (rbc_status text, rbc_tenant_id uuid, rbc_application_id uuid, rbc_credential_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_hash text;
  v_id uuid; v_tenant uuid; v_app uuid; v_status public.backend_credential_status;
begin
  if p_secret is null or left(p_secret, 13) <> 'authority_dk_' or char_length(p_secret) <> 77 then
    return query select 'malformed'::text, null::uuid, null::uuid, null::uuid; return;
  end if;
  v_hash := encode(extensions.digest(p_secret, 'sha256'), 'hex');
  select id, tenant_id, application_id, status into v_id, v_tenant, v_app, v_status
  from public.developer_backend_credentials where key_hash = v_hash;
  if v_id is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid; return;
  end if;
  if v_status = 'revoked' then
    return query select 'revoked'::text, null::uuid, null::uuid, null::uuid; return;
  end if;
  update public.developer_backend_credentials set last_used_at = now() where id = v_id;
  return query select 'ok'::text, v_tenant, v_app, v_id;
end;
$fn$;
revoke all on function gateway.resolve_backend_credential(text) from public;
grant execute on function gateway.resolve_backend_credential(text) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000002'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
