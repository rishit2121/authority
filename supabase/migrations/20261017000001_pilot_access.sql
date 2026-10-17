-- Invite-only developer pilot.
--
-- * pilot_access: one row per normalized email -- a public access request, a
--   manually added address, or both. status 'approved' is pilot eligibility;
--   it is never authentication (Supabase still verifies email ownership) and
--   never grants workspace data (membership + RLS still decide that).
-- * pilot_settings: the owner's email and whether the invite-only gate is on.
--   The gate starts OFF so the owner can approve existing accounts first;
--   only the owner can turn it on. The owner is always eligible.
-- * Enforcement in the database: public.ensure_onboarded() refuses to create a
--   workspace for an ineligible account, so an auth user created by calling
--   Supabase directly gets nothing. The app gates the console, server actions,
--   the auth callback and session APIs on public.pilot_viewer().
-- * Nothing here applies to an application's external customers (backend and
--   agent credentials never touch auth.uid()).
-- * Tables have RLS on and no grants: anon/authenticated can never read or
--   write them. Public submission goes through a gateway-role function;
--   management goes through owner-only functions that check the caller's
--   verified email in auth.users.

create table public.pilot_settings (
  id boolean primary key default true check (id),
  owner_email text not null check (owner_email = lower(btrim(owner_email)) and char_length(owner_email) between 3 and 254),
  gate_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.pilot_settings (owner_email) values ('owner@example.invalid');

create table public.pilot_access (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 254),
  email_normalized text not null unique check (email_normalized = lower(btrim(email_normalized))),
  name text check (name is null or char_length(name) <= 120),
  company text check (company is null or char_length(company) <= 200),
  building text check (building is null or char_length(building) <= 2000),
  usage text check (usage is null or char_length(usage) <= 2000),
  services text check (services is null or char_length(services) <= 500),
  source text not null check (source in ('request', 'manual', 'existing_account')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  admin_notes text check (admin_notes is null or char_length(admin_notes) <= 4000),
  submit_count integer not null default 0,
  submitted_at timestamptz,
  last_submitted_at timestamptz,
  decided_at timestamptz,
  notification_status text check (notification_status in ('sent', 'failed', 'not_configured')),
  notification_detail text check (notification_detail is null or char_length(notification_detail) <= 200),
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pilot_access_status_idx on public.pilot_access (status, created_at desc);

create table public.pilot_request_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  email_normalized text,
  created_at timestamptz not null default now()
);
create index pilot_request_attempts_ip_idx on public.pilot_request_attempts (ip_hash, created_at desc);
create index pilot_request_attempts_email_idx on public.pilot_request_attempts (email_normalized, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['pilot_settings', 'pilot_access', 'pilot_request_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Identity helpers: always from auth.users (verified), never from claims or input.
-- ---------------------------------------------------------------------------
create or replace function authz.current_verified_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(u.email)) from auth.users u
  where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
$$;
revoke all on function authz.current_verified_email() from public, anon;

create or replace function authz.is_pilot_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select authz.current_verified_email()) = (select owner_email from public.pilot_settings), false);
$$;
revoke all on function authz.is_pilot_owner() from public, anon;

-- 'eligible' | 'not_approved' | 'unconfirmed' | 'unauthenticated'
create or replace function authz.pilot_access_for_current_user()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_gate boolean; v_email text;
begin
  if (select auth.uid()) is null then return 'unauthenticated'; end if;
  select gate_enabled into v_gate from public.pilot_settings;
  if not coalesce(v_gate, false) then return 'eligible'; end if;
  v_email := authz.current_verified_email();
  if v_email is null then return 'unconfirmed'; end if;
  if authz.is_pilot_owner() then return 'eligible'; end if;
  if exists (select 1 from public.pilot_access where email_normalized = v_email and status = 'approved') then
    return 'eligible';
  end if;
  return 'not_approved';
end;
$fn$;
revoke all on function authz.pilot_access_for_current_user() from public, anon;

create or replace function public.pilot_viewer()
returns table (pv_access text, pv_is_owner boolean, pv_gate_enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select authz.pilot_access_for_current_user(), authz.is_pilot_owner(),
    coalesce((select gate_enabled from public.pilot_settings), false);
$$;
revoke all on function public.pilot_viewer() from public, anon;
grant execute on function public.pilot_viewer() to authenticated;

-- ---------------------------------------------------------------------------
-- The database gate: no workspace for an ineligible account.
-- ---------------------------------------------------------------------------
alter function public.ensure_onboarded() set schema authz;
alter function authz.ensure_onboarded() rename to ensure_onboarded_core;
revoke all on function authz.ensure_onboarded_core() from public, anon, authenticated;

create function public.ensure_onboarded()
returns table (tenant_id uuid, was_created boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if authz.pilot_access_for_current_user() <> 'eligible' then
    raise exception 'Authority is currently invite-only: this account is not approved for the pilot'
      using errcode = '42501';
  end if;
  return query select * from authz.ensure_onboarded_core();
end;
$fn$;
revoke all on function public.ensure_onboarded() from public, anon;
grant execute on function public.ensure_onboarded() to authenticated;

-- ---------------------------------------------------------------------------
-- Public submission (gateway role, called by the server action only).
-- ---------------------------------------------------------------------------
create or replace function gateway.submit_pilot_request(
  p_name text, p_email text, p_company text, p_building text, p_usage text, p_services text, p_ip_hash text
)
returns table (spr_status text, spr_request_id uuid, spr_is_new boolean, spr_owner_email text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid; v_new boolean := false;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return query select 'invalid_request'::text, null::uuid, false, null::text; return;
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254
     or char_length(btrim(coalesce(p_name, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_building, ''))) not between 1 and 2000
     or char_length(btrim(coalesce(p_usage, ''))) not between 1 and 2000
     or char_length(coalesce(p_company, '')) > 200 or char_length(coalesce(p_services, '')) > 500 then
    return query select 'invalid_request'::text, null::uuid, false, null::text; return;
  end if;

  delete from public.pilot_request_attempts where created_at < now() - interval '1 day';
  if (select count(*) from public.pilot_request_attempts where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.pilot_request_attempts where email_normalized = v_email and created_at > now() - interval '1 hour') >= 3 then
    return query select 'rate_limited'::text, null::uuid, false, null::text; return;
  end if;
  insert into public.pilot_request_attempts (ip_hash, email_normalized) values (p_ip_hash, v_email);

  perform pg_advisory_xact_lock(hashtextextended('authority.pilot_request:' || v_email, 0));
  select id into v_id from public.pilot_access where email_normalized = v_email;
  if v_id is null then
    insert into public.pilot_access (email, email_normalized, name, company, building, usage, services, source, submit_count, submitted_at, last_submitted_at)
    values (btrim(p_email), v_email, btrim(p_name), nullif(btrim(p_company), ''), btrim(p_building), btrim(p_usage),
            nullif(btrim(p_services), ''), 'request', 1, now(), now())
    returning id into v_id;
    v_new := true;
  else
    -- Dedup: refresh what they told us; status and private notes are never touched by the public form.
    update public.pilot_access set
      name = btrim(p_name), company = nullif(btrim(p_company), ''), building = btrim(p_building), usage = btrim(p_usage),
      services = nullif(btrim(p_services), ''), submit_count = submit_count + 1,
      submitted_at = coalesce(submitted_at, now()), last_submitted_at = now(), updated_at = now()
    where id = v_id;
  end if;
  return query select 'ok'::text, v_id, v_new, (select owner_email from public.pilot_settings);
end;
$fn$;
revoke all on function gateway.submit_pilot_request(text, text, text, text, text, text, text) from public;
grant execute on function gateway.submit_pilot_request(text, text, text, text, text, text, text) to authority_gateway;

create or replace function gateway.record_pilot_notification(p_id uuid, p_status text, p_detail text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.pilot_access
  set notification_status = p_status, notification_detail = left(p_detail, 200), notified_at = now()
  where id = p_id and p_status in ('sent', 'failed', 'not_configured');
$$;
revoke all on function gateway.record_pilot_notification(uuid, text, text) from public;
grant execute on function gateway.record_pilot_notification(uuid, text, text) to authority_gateway;

-- Sign-up pre-check (server action only): may this address create an account right now?
create or replace function gateway.pilot_signup_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not coalesce((select gate_enabled from public.pilot_settings), false)
    or lower(btrim(p_email)) = (select owner_email from public.pilot_settings)
    or exists (select 1 from public.pilot_access where email_normalized = lower(btrim(p_email)) and status = 'approved');
$$;
revoke all on function gateway.pilot_signup_allowed(text) from public;
grant execute on function gateway.pilot_signup_allowed(text) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Owner-only management (verified owner email, checked here, on every call).
-- ---------------------------------------------------------------------------
create or replace function authz.require_pilot_owner()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not authz.is_pilot_owner() then
    raise exception 'pilot management is restricted to the platform owner' using errcode = '42501';
  end if;
end;
$$;
revoke all on function authz.require_pilot_owner() from public, anon;

create or replace function public.pilot_admin_list()
returns setof public.pilot_access
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform authz.require_pilot_owner();
  return query select * from public.pilot_access order by coalesce(last_submitted_at, created_at) desc limit 1000;
end;
$$;
revoke all on function public.pilot_admin_list() from public, anon;
grant execute on function public.pilot_admin_list() to authenticated;

create or replace function public.pilot_admin_update(p_id uuid, p_status text, p_notes text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform authz.require_pilot_owner();
  if p_status is not null and p_status not in ('pending', 'approved', 'declined') then return 'invalid_request'; end if;
  if p_notes is not null and char_length(p_notes) > 4000 then return 'invalid_request'; end if;
  update public.pilot_access set
    status = coalesce(p_status, status),
    decided_at = case when p_status is not null and p_status <> status then now() else decided_at end,
    admin_notes = case when p_notes is null then admin_notes else nullif(btrim(p_notes), '') end,
    updated_at = now()
  where id = p_id;
  return case when found then 'ok' else 'not_found' end;
end;
$$;
revoke all on function public.pilot_admin_update(uuid, text, text) from public, anon;
grant execute on function public.pilot_admin_update(uuid, text, text) to authenticated;

create or replace function public.pilot_admin_add(p_email text, p_name text, p_notes text, p_source text default 'manual')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_email text := lower(btrim(coalesce(p_email, '')));
begin
  perform authz.require_pilot_owner();
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 or char_length(coalesce(p_name, '')) > 120
     or char_length(coalesce(p_notes, '')) > 4000 or p_source not in ('manual', 'existing_account') then
    return 'invalid_request';
  end if;
  insert into public.pilot_access (email, email_normalized, name, admin_notes, source, status, decided_at)
  values (btrim(p_email), v_email, nullif(btrim(p_name), ''), nullif(btrim(p_notes), ''), p_source, 'approved', now())
  on conflict (email_normalized) do update
    set status = 'approved', decided_at = now(), updated_at = now(),
        name = coalesce(public.pilot_access.name, excluded.name),
        admin_notes = coalesce(excluded.admin_notes, public.pilot_access.admin_notes);
  return 'ok';
end;
$$;
revoke all on function public.pilot_admin_add(text, text, text, text) from public, anon;
grant execute on function public.pilot_admin_add(text, text, text, text) to authenticated;

-- Existing Authority accounts, so the owner can approve the ones to keep before turning the gate on.
create or replace function public.pilot_admin_accounts()
returns table (pa_email text, pa_created_at timestamptz, pa_confirmed boolean, pa_last_sign_in_at timestamptz, pa_status text, pa_is_owner boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform authz.require_pilot_owner();
  return query
    select u.email::text, u.created_at, u.email_confirmed_at is not null, u.last_sign_in_at,
      coalesce(p.status, 'none'), lower(btrim(u.email)) = (select owner_email from public.pilot_settings)
    from auth.users u
    left join public.pilot_access p on p.email_normalized = lower(btrim(u.email))
    where u.email is not null
    order by u.created_at desc
    limit 1000;
end;
$$;
revoke all on function public.pilot_admin_accounts() from public, anon;
grant execute on function public.pilot_admin_accounts() to authenticated;

create or replace function public.pilot_admin_set_gate(p_enabled boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform authz.require_pilot_owner();
  update public.pilot_settings set gate_enabled = coalesce(p_enabled, false), updated_at = now();
  return 'ok';
end;
$$;
revoke all on function public.pilot_admin_set_gate(boolean) from public, anon;
grant execute on function public.pilot_admin_set_gate(boolean) to authenticated;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261017000001'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
