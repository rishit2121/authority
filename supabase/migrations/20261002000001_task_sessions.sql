-- Task sessions: a short-lived, opaque token an agent exchanges its runtime
-- key for once per task, so it doesn't have to present the long-lived key on
-- every authorize/execute call. A session grants NO tool permission by
-- itself -- it is a resolved identity (tenant, agent, the credential that
-- created it) that the existing authorization pipeline re-verifies on every
-- single call, exactly as it already does for a raw runtime key.
--
-- Deliberately NOT modeled as a capability: a capability authorizes one
-- exact tool/operation/resource for a few seconds. A session authorizes
-- nothing on its own and exists only to carry identity across calls for up
-- to 15 minutes.
--
-- Deliberately NOT a new, parallel authentication path either: see
-- gateway.resolve_credential below, redefined (not replaced) to also accept
-- a session token. Every function that already authenticates a caller by
-- calling resolve_credential -- prepare_authorization, commit_authorization,
-- reserve_connector_execution, reserve_execution (GitHub), consume_capability,
-- revoke_capability, approval_for_request, approval_by_id -- gains session
-- support automatically, with none of their own bodies touched, because
-- they all still just call the one function and read the same four columns
-- it has always returned. Only gateway.prepare_authorization gets one small,
-- additional, separate check (below) that only it needs: confirming a
-- session is still bound to the exact task and exact active contract it was
-- issued for, since that's the one place a task id is already an input.

create table public.task_sessions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  agent_id    uuid not null,
  task_id     uuid not null,
  -- The runtime key that created this session. If that key is later
  -- revoked, resolve_credential's session branch refuses the session too --
  -- a session is never more durable than the credential that minted it.
  issuing_credential_id uuid not null,
  -- The task's active contract at creation time. prepare_authorization
  -- re-checks this is STILL the task's active contract on every use; a
  -- contract change (new version, revocation) invalidates the session
  -- rather than silently carrying it forward onto different authority.
  contract_id uuid not null,
  contract_version integer not null check (contract_version > 0),
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  format_version integer not null default 1 check (format_version = 1),
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  status      text not null default 'active' check (status in ('active', 'revoked')),
  revoked_at  timestamptz,
  revocation_reason text check (revocation_reason is null or char_length(revocation_reason) <= 500),
  last_used_at timestamptz,
  unique (id, tenant_id),
  foreign key (agent_id, tenant_id) references public.agents (id, tenant_id),
  foreign key (task_id, tenant_id) references public.tasks (id, tenant_id),
  foreign key (issuing_credential_id, tenant_id) references public.agent_credentials (id, tenant_id),
  foreign key (contract_id, tenant_id) references public.task_authority_contracts (id, tenant_id),
  constraint task_session_short_lived
    check (expires_at > issued_at and expires_at - issued_at <= interval '15 minutes'),
  constraint task_session_revoked_has_timestamp check ((status = 'revoked') = (revoked_at is not null))
);
create index task_sessions_tenant_idx on public.task_sessions (tenant_id, issued_at desc);
create index task_sessions_task_idx on public.task_sessions (task_id);

alter table public.task_sessions enable row level security;
revoke all on public.task_sessions from public, anon, authenticated;
-- token_hash is never readable, even by an admin -- same column-level
-- lockdown as capability_tokens.
grant select (id, tenant_id, agent_id, task_id, issuing_credential_id, contract_id, contract_version,
  format_version, issued_at, expires_at, status, revoked_at, revocation_reason, last_used_at)
  on public.task_sessions to authenticated;
create policy "task_sessions_select_within_tenant" on public.task_sessions
  for select to authenticated using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- gateway.resolve_credential: redefined, not replaced. The existing
-- runtime-key branch below is byte-for-byte what it always was (same rate
-- limiting, same audit trail, same revocation check) -- a session token
-- (`authority_ts_...`) is recognized by its distinct prefix and handled in
-- a new branch above it; a runtime key (`authority_rk_...`, or anything
-- else) falls through to that unchanged logic. Same four-column return
-- shape either way, so every existing caller needs no change at all.
-- ---------------------------------------------------------------------------
create or replace function gateway.resolve_credential(p_secret text)
returns table (rc_status text, rc_tenant_id uuid, rc_agent_id uuid, rc_credential_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_prefix text;
  v_recent integer;
  v_id uuid;
  v_tenant uuid;
  v_agent uuid;
  v_status public.agent_credential_status;
  v_agent_status public.agent_status;
  v_sess_id uuid;
  v_sess_status text;
  v_sess_expires timestamptz;
begin
  if p_secret is null or char_length(p_secret) < 10 or char_length(p_secret) > 200 then
    return query select 'invalid_credential'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  if left(p_secret, 13) = 'authority_ts_' then
    select ts.id, ts.tenant_id, ts.agent_id, ts.issuing_credential_id, ts.status, ts.expires_at
      into v_sess_id, v_tenant, v_agent, v_id, v_sess_status, v_sess_expires
    from public.task_sessions ts
    where ts.token_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex');

    if v_sess_id is null then
      return query select 'invalid_credential'::text, null::uuid, null::uuid, null::uuid;
      return;
    end if;
    if v_sess_status = 'revoked' then
      return query select 'session_revoked'::text, null::uuid, null::uuid, null::uuid;
      return;
    end if;
    if v_sess_expires <= now() then
      return query select 'session_expired'::text, null::uuid, null::uuid, null::uuid;
      return;
    end if;

    select ac.status into v_status from public.agent_credentials ac where ac.id = v_id;
    select ag.status into v_agent_status from public.agents ag where ag.id = v_agent;
    if v_status is distinct from 'active'::public.agent_credential_status
       or v_agent_status is distinct from 'active'::public.agent_status then
      return query select 'revoked_credential'::text, null::uuid, null::uuid, null::uuid;
      return;
    end if;

    update public.task_sessions set last_used_at = now() where id = v_sess_id;
    return query select 'ok'::text, v_tenant, v_agent, v_id;
    return;
  end if;

  v_prefix := left(p_secret, 21);

  select count(*) into v_recent
  from public.agent_auth_events aae
  where aae.attempted_key_prefix = v_prefix
    and aae.outcome in ('invalid_credential', 'rate_limited')
    and aae.created_at > now() - interval '60 seconds';

  if v_recent >= 20 then
    if v_recent < 200 then
      insert into public.agent_auth_events (attempted_key_prefix, outcome) values (v_prefix, 'rate_limited');
    end if;
    return query select 'rate_limited'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  select ac.id, ac.tenant_id, ac.agent_id, ac.status
    into v_id, v_tenant, v_agent, v_status
  from public.agent_credentials ac
  where ac.key_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex');

  if v_id is null then
    insert into public.agent_auth_events (attempted_key_prefix, outcome) values (v_prefix, 'invalid_credential');
    return query select 'invalid_credential'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  select ag.status into v_agent_status from public.agents ag where ag.id = v_agent and ag.tenant_id = v_tenant;

  if v_status <> 'active' or v_agent_status is distinct from 'active'::public.agent_status then
    insert into public.agent_auth_events (tenant_id, agent_id, credential_id, attempted_key_prefix, outcome)
      values (v_tenant, v_agent, v_id, v_prefix, 'revoked_credential');
    return query select 'revoked_credential'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  update public.agent_credentials set last_used_at = now() where id = v_id;
  return query select 'ok'::text, v_tenant, v_agent, v_id;
end;
$fn$;
revoke all on function gateway.resolve_credential(text) from public;
grant execute on function gateway.resolve_credential(text) to authority_gateway;

-- ---------------------------------------------------------------------------
-- gateway.create_task_session: the runtime key's one-time exchange for a
-- session. Requires the task to already have an active contract -- a
-- session is a convenience over an authorized task, never a way to get
-- ahead of contract activation. Note this deliberately calls
-- resolve_credential directly, not itself: creating a session from an
-- existing session is not supported (sessions do not nest or renew by
-- extension; a fresh session always traces back to the runtime key).
-- ---------------------------------------------------------------------------
create or replace function gateway.create_task_session(
  p_credential_secret text,
  p_task_id uuid,
  p_token_hash text,
  p_ttl_seconds integer
)
returns table (
  cts_status text,
  cts_session_id uuid,
  cts_agent_id uuid,
  cts_contract_id uuid,
  cts_contract_version integer,
  cts_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_tenant uuid;
  v_agent uuid;
  v_cred uuid;
  v_task_agent uuid;
  v_contract uuid;
  v_version integer;
  v_ttl integer;
  v_session uuid;
  v_expires timestamptz;
begin
  if p_credential_secret is null or left(p_credential_secret, 13) = 'authority_ts_' then
    return query select 'invalid_credential'::text, null::uuid, null::uuid, null::uuid, null::integer,
      null::timestamptz;
    return;
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'malformed session token' using errcode = '22023';
  end if;
  v_ttl := coalesce(p_ttl_seconds, 900);
  if v_ttl < 60 or v_ttl > 900 then
    raise exception 'ttl must be 60-900 seconds' using errcode = '22023';
  end if;

  select rc.rc_status, rc.rc_tenant_id, rc.rc_agent_id, rc.rc_credential_id
    into v_status, v_tenant, v_agent, v_cred
  from gateway.resolve_credential(p_credential_secret) rc;
  if v_status <> 'ok' then
    return query select v_status, null::uuid, null::uuid, null::uuid, null::integer, null::timestamptz;
    return;
  end if;

  select t.agent_id into v_task_agent from public.tasks t where t.id = p_task_id and t.tenant_id = v_tenant;
  if v_task_agent is null then
    return query select 'task_not_found'::text, null::uuid, null::uuid, null::uuid, null::integer,
      null::timestamptz;
    return;
  end if;
  if v_task_agent <> v_agent then
    return query select 'agent_mismatch'::text, null::uuid, null::uuid, null::uuid, null::integer,
      null::timestamptz;
    return;
  end if;

  select acft.acft_contract_id into v_contract from gateway.active_contract_for_task(p_task_id) acft;
  if v_contract is null then
    return query select 'no_active_contract'::text, null::uuid, null::uuid, null::uuid, null::integer,
      null::timestamptz;
    return;
  end if;
  select c.version into v_version from public.task_authority_contracts c
    where c.id = v_contract and c.tenant_id = v_tenant;

  v_expires := now() + make_interval(secs => v_ttl);
  insert into public.task_sessions
    (tenant_id, agent_id, task_id, issuing_credential_id, contract_id, contract_version, token_hash, expires_at)
  values (v_tenant, v_agent, p_task_id, v_cred, v_contract, v_version, p_token_hash, v_expires)
  returning id into v_session;

  return query select 'ok'::text, v_session, v_agent, v_contract, v_version, v_expires;
end;
$fn$;
revoke all on function gateway.create_task_session(text, uuid, text, integer) from public;
grant execute on function gateway.create_task_session(text, uuid, text, integer) to authority_gateway;

-- ---------------------------------------------------------------------------
-- gateway.revoke_task_session: self-revocation, authenticated by the session
-- token itself (not the runtime key) -- the same "you hold it, you can end
-- it" shape as a capability's own revoke. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function gateway.revoke_task_session(p_token text, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sess_id uuid;
  v_sess_status text;
begin
  if p_token is null or left(p_token, 13) <> 'authority_ts_' then
    return 'invalid_token';
  end if;

  select ts.id, ts.status into v_sess_id, v_sess_status
  from public.task_sessions ts
  where ts.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  if v_sess_id is null then return 'not_found'; end if;
  if v_sess_status = 'revoked' then return 'already_revoked'; end if;

  update public.task_sessions
    set status = 'revoked', revoked_at = now(),
        revocation_reason = coalesce(nullif(btrim(p_reason), ''), 'agent requested')
    where id = v_sess_id;
  return 'ok';
end;
$fn$;
revoke all on function gateway.revoke_task_session(text, text) from public;
grant execute on function gateway.revoke_task_session(text, text) to authority_gateway;

-- ---------------------------------------------------------------------------
-- gateway.task_session_info: read-only introspection for
-- GET /api/v1/sessions/current. Deliberately separate from
-- resolve_credential -- this is the only place a session's own id, task,
-- contract and expiry are exposed to a caller, and the only place a
-- distinct reason (expired vs. revoked vs. unknown) is given instead of the
-- single collapsed UNAUTHENTICATED every other endpoint uses.
-- ---------------------------------------------------------------------------
create or replace function gateway.task_session_info(p_token text)
returns table (
  tsi_status text,
  tsi_session_id uuid,
  tsi_agent_id uuid,
  tsi_task_id uuid,
  tsi_contract_id uuid,
  tsi_contract_version integer,
  tsi_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sess_id uuid;
  v_sess_agent uuid;
  v_sess_task uuid;
  v_sess_cred uuid;
  v_sess_contract uuid;
  v_sess_version integer;
  v_sess_status text;
  v_sess_expires timestamptz;
  v_cred_status public.agent_credential_status;
  v_agent_status public.agent_status;
begin
  if p_token is null or left(p_token, 13) <> 'authority_ts_' then
    return query select 'invalid_token'::text, null::uuid, null::uuid, null::uuid, null::uuid, null::integer,
      null::timestamptz;
    return;
  end if;

  select ts.id, ts.agent_id, ts.task_id, ts.issuing_credential_id, ts.contract_id, ts.contract_version,
         ts.status, ts.expires_at
    into v_sess_id, v_sess_agent, v_sess_task, v_sess_cred, v_sess_contract, v_sess_version, v_sess_status,
         v_sess_expires
  from public.task_sessions ts
  where ts.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  if v_sess_id is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid, null::uuid, null::integer,
      null::timestamptz;
    return;
  end if;
  if v_sess_status = 'revoked' then
    return query select 'revoked'::text, null::uuid, null::uuid, null::uuid, null::uuid, null::integer,
      null::timestamptz;
    return;
  end if;
  if v_sess_expires <= now() then
    return query select 'expired'::text, null::uuid, null::uuid, null::uuid, null::uuid, null::integer,
      null::timestamptz;
    return;
  end if;

  select ac.status into v_cred_status from public.agent_credentials ac where ac.id = v_sess_cred;
  select ag.status into v_agent_status from public.agents ag where ag.id = v_sess_agent;
  if v_cred_status is distinct from 'active'::public.agent_credential_status
     or v_agent_status is distinct from 'active'::public.agent_status then
    return query select 'credential_revoked'::text, null::uuid, null::uuid, null::uuid, null::uuid,
      null::integer, null::timestamptz;
    return;
  end if;

  return query select 'ok'::text, v_sess_id, v_sess_agent, v_sess_task, v_sess_contract, v_sess_version,
    v_sess_expires;
end;
$fn$;
revoke all on function gateway.task_session_info(text) from public;
grant execute on function gateway.task_session_info(text) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261002000001'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
