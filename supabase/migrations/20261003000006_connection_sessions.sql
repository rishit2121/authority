-- Embedded customer connections, part 6: the generic connection-session
-- lifecycle behind Mode A ("Authority manages a new connection").
--
-- Provider-agnostic on purpose: this table and its RPCs know nothing about
-- Gmail's or any other provider's own OAuth mechanics (PKCE, scopes,
-- token exchange) -- that stays in each connector's existing oauth.ts, the
-- same module that already does it for the dashboard-operated flow. What's
-- new here is the *session* a browser carries from Acme's backend, through
-- the provider's consent screen, back to an allowlisted Acme return URL,
-- without Alex ever holding an Authority credential or visiting a dashboard
-- login page. A provider-specific callback route resolves this session by
-- its token, drives that provider's own existing oauth.ts exchange, and
-- then calls complete_connection_session() -- exactly mirroring how the
-- existing dashboard Gmail callback already calls setConnectorSecret()
-- after its own exchange.

create type public.connection_session_status as enum ('pending', 'completed', 'expired', 'cancelled', 'denied');

create table public.connection_sessions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  application_id uuid not null,
  customer_id   uuid not null,
  connector_id  text not null check (connector_id ~ '^[a-z0-9_]{1,64}$'),
  -- Only the hash is stored; the plaintext opaque token is the one thing
  -- the backend credential's create call returns, and it is the whole
  -- "connection URL" Acme redirects Alex to -- same one-time-display
  -- discipline as every other secret in this schema.
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Binds this session to the browser that started it, the same role
  -- Gmail's own STATE_COOKIE nonce already plays for the dashboard flow --
  -- here it additionally binds to the right application/customer/connector,
  -- not just "some pending flow."
  nonce_hash    text not null check (nonce_hash ~ '^[0-9a-f]{64}$'),
  return_url    text not null check (char_length(return_url) between 1 and 2000),
  status        public.connection_session_status not null default 'pending',
  created_connection_id uuid,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  completed_at  timestamptz,
  unique (id, tenant_id),
  foreign key (application_id, tenant_id) references public.applications (id, tenant_id),
  foreign key (customer_id, tenant_id) references public.customers (id, tenant_id),
  foreign key (created_connection_id, tenant_id) references public.connector_connections (id, tenant_id),
  constraint connection_session_short_lived
    check (expires_at > created_at and expires_at - created_at <= interval '30 minutes'),
  constraint connection_session_terminal_shape
    check ((status = 'completed') = (completed_at is not null and created_connection_id is not null))
);

create index connection_sessions_customer_idx on public.connection_sessions (customer_id, created_at);
create index connection_sessions_expiry_idx on public.connection_sessions (expires_at) where status = 'pending';

alter table public.connection_sessions enable row level security;
revoke all on public.connection_sessions from public, anon, authenticated;
grant select (
  id, tenant_id, application_id, customer_id, connector_id, return_url, status,
  created_connection_id, created_at, expires_at, completed_at
) on public.connection_sessions to authenticated;
create policy "connection_sessions_select_within_tenant" on public.connection_sessions
  for select to authenticated using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- Open a session. The return URL must exactly match one already registered
-- on the application -- never a pattern, never an argument the caller can
-- widen, so this can never become an open redirect.
-- ---------------------------------------------------------------------------
create or replace function gateway.create_connection_session(
  p_secret text, p_customer_id uuid, p_connector_id text, p_return_url text
)
returns table (ccs_status text, ccs_session_id uuid, ccs_token text, ccs_nonce text, ccs_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid;
  v_customer_app uuid;
  v_allowed text[];
  v_token text; v_nonce text;
  v_id uuid; v_expires timestamptz;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::text, null::text, null::timestamptz; return;
  end if;

  select application_id into v_customer_app from public.customers where id = p_customer_id and tenant_id = v_tenant;
  if v_customer_app is null or v_customer_app <> v_app then
    return query select 'customer_not_found'::text, null::uuid, null::text, null::text, null::timestamptz; return;
  end if;

  select allowed_return_urls into v_allowed from public.applications where id = v_app;
  if not (p_return_url = any(coalesce(v_allowed, '{}'::text[]))) then
    return query select 'return_url_not_allowed'::text, null::uuid, null::text, null::text, null::timestamptz; return;
  end if;

  v_token := 'authority_cs_' || encode(extensions.gen_random_bytes(32), 'base64');
  v_token := translate(v_token, '+/=', '-_');
  v_nonce := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_expires := now() + interval '20 minutes';

  insert into public.connection_sessions (
    tenant_id, application_id, customer_id, connector_id, token_hash, nonce_hash, return_url, expires_at
  ) values (
    v_tenant, v_app, p_customer_id, p_connector_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'), encode(extensions.digest(v_nonce, 'sha256'), 'hex'),
    p_return_url, v_expires
  ) returning id into v_id;

  return query select 'ok'::text, v_id, v_token, v_nonce, v_expires;
end;
$fn$;

revoke all on function gateway.create_connection_session(text, uuid, text, text) from public;
grant execute on function gateway.create_connection_session(text, uuid, text, text) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Resolve a pending session by its plaintext token -- called only by a
-- provider-specific callback route after Alex returns from the provider's
-- consent screen, never by a backend credential. The nonce hash is returned
-- so the route can verify it against the browser's own state cookie before
-- trusting anything else about this session (replay/wrong-browser
-- protection, same role Gmail's existing STATE_COOKIE check already plays).
-- Expired sessions resolve as not found, not as a distinct status, so an
-- attacker learns nothing about whether a guessed token ever existed.
-- ---------------------------------------------------------------------------
create or replace function gateway.resolve_connection_session(p_token text)
returns table (rcs_status text, rcs_session_id uuid, rcs_tenant_id uuid, rcs_application_id uuid,
               rcs_customer_id uuid, rcs_connector_id text, rcs_nonce_hash text, rcs_return_url text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_hash text;
  v_row record;
begin
  if p_token is null or left(p_token, 13) <> 'authority_cs_' then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::text, null::text;
    return;
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select * into v_row from public.connection_sessions where token_hash = v_hash;
  if v_row.id is null or v_row.status <> 'pending' or v_row.expires_at <= now() then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid, null::uuid, null::text, null::text, null::text;
    return;
  end if;
  return query select 'ok'::text, v_row.id, v_row.tenant_id, v_row.application_id, v_row.customer_id,
    v_row.connector_id, v_row.nonce_hash, v_row.return_url;
end;
$fn$;
revoke all on function gateway.resolve_connection_session(text) from public;
grant execute on function gateway.resolve_connection_session(text) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Terminal transitions. complete_connection_session is the only one that
-- also stamps created_connection_id, and it is single-use: calling it twice
-- for the same session (replay of the callback request) does nothing the
-- second time rather than re-processing or erroring in a way that leaks
-- timing information about the first call.
-- ---------------------------------------------------------------------------
create or replace function gateway.complete_connection_session(p_token text, p_connection_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_hash text; v_updated integer;
begin
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  update public.connection_sessions
  set status = 'completed', completed_at = now(), created_connection_id = p_connection_id
  where token_hash = v_hash and status = 'pending' and expires_at > now();
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return 'already_resolved_or_expired';
  end if;
  return 'ok';
end;
$fn$;
revoke all on function gateway.complete_connection_session(text, uuid) from public;
grant execute on function gateway.complete_connection_session(text, uuid) to authority_gateway;

create or replace function gateway.fail_connection_session(p_token text, p_status text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_hash text; v_updated integer;
begin
  if p_status not in ('cancelled', 'denied', 'expired') then
    raise exception 'invalid terminal status' using errcode = '22023';
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  update public.connection_sessions
  set status = p_status::public.connection_session_status
  where token_hash = v_hash and status = 'pending';
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return 'already_resolved_or_expired';
  end if;
  return 'ok';
end;
$fn$;
revoke all on function gateway.fail_connection_session(text, text) from public;
grant execute on function gateway.fail_connection_session(text, text) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Status read for Acme's own backend (not the browser) to poll after
-- redirecting Alex back -- authenticated by the backend credential, scoped
-- to that application, so one application's backend can never poll another
-- application's session status even inside the same tenant.
-- ---------------------------------------------------------------------------
create or replace function gateway.connection_session_status(p_secret text, p_session_id uuid)
returns table (css_status text, css_session_status text, css_connector_id text,
               css_connection_id uuid, css_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid;
  v_row record;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then
    return query select v_status, null::text, null::text, null::uuid, null::timestamptz; return;
  end if;

  select * into v_row from public.connection_sessions
  where id = p_session_id and tenant_id = v_tenant and application_id = v_app;
  if v_row.id is null then
    return query select 'session_not_found'::text, null::text, null::text, null::uuid, null::timestamptz; return;
  end if;

  return query select 'ok'::text, v_row.status::text, v_row.connector_id, v_row.created_connection_id, v_row.expires_at;
end;
$fn$;
revoke all on function gateway.connection_session_status(text, uuid) from public;
grant execute on function gateway.connection_session_status(text, uuid) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261003000006'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
