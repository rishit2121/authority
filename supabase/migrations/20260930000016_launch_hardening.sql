-- Part 8 launch hardening: retention settings + purge, webhook retry queue, installation re-verification queue,
-- a schema-version probe for readiness, and a correction to how expired validation campaigns are finalized.
-- Additive only. Nothing here changes an authorization decision.

-- ---------------------------------------------------------------------------
-- 1. An expired campaign is a finished campaign.
-- ---------------------------------------------------------------------------
create or replace function gateway.vl_set_campaign(p_tenant uuid, p_campaign uuid, p_status text, p_progress jsonb, p_summary jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.validation_campaigns set
      status = coalesce(p_status, status), progress = coalesce(p_progress, progress), summary = coalesce(p_summary, summary),
      started_at = case when p_status = 'running' and started_at is null then now() else started_at end,
      finished_at = case when p_status in ('completed', 'cancelled', 'failed', 'expired') then now() else finished_at end
    where id = p_campaign and tenant_id = p_tenant and status in ('queued', 'running');
end;
$fn$;
revoke all on function gateway.vl_set_campaign(uuid, uuid, text, jsonb, jsonb) from public;
grant execute on function gateway.vl_set_campaign(uuid, uuid, text, jsonb, jsonb) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 2. Schema-version probe. The application compares this with the version it was built for, so a deploy against an
--    un-migrated database is reported by readiness instead of failing later inside a request.
-- ---------------------------------------------------------------------------
create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20260930000016'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;

-- ---------------------------------------------------------------------------
-- 3. Retention. Only data that is safe to age out is purged: validation artifacts (synthetic, reproducible from the
--    immutable scenario versions), finished webhook retry rows and old webhook delivery ids. Decisions, receipts,
--    approvals and authentication events are append-only audit records and are NOT purged by this mechanism.
-- ---------------------------------------------------------------------------
create table public.tenant_retention_settings (
  tenant_id       uuid primary key references public.tenants (id) on delete cascade,
  validation_days integer not null default 30 check (validation_days between 7 and 365),
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);
alter table public.tenant_retention_settings enable row level security;
revoke all on public.tenant_retention_settings from public, anon, authenticated;
grant select on public.tenant_retention_settings to authenticated;
create policy tenant_retention_settings_select_within_tenant on public.tenant_retention_settings
  for select to authenticated using (authz.is_member_of(tenant_id));

create or replace function public.set_retention_settings(p_tenant_id uuid, p_validation_days integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if (select auth.uid()) is null then raise exception 'requires an authenticated caller' using errcode = '28000'; end if;
  if not authz.is_member_of(p_tenant_id) then raise exception 'not found' using errcode = 'P0002'; end if;
  if not authz.has_min_role(p_tenant_id, 'admin') then raise exception 'insufficient privileges' using errcode = '42501'; end if;
  if p_validation_days is null or p_validation_days not between 7 and 365 then
    raise exception 'validation retention must be 7-365 days' using errcode = '22023';
  end if;
  insert into public.tenant_retention_settings (tenant_id, validation_days, updated_by)
  values (p_tenant_id, p_validation_days, (select auth.uid()))
  on conflict (tenant_id) do update set validation_days = excluded.validation_days, updated_by = excluded.updated_by, updated_at = now();
  return p_validation_days;
end;
$fn$;
revoke all on function public.set_retention_settings(uuid, integer) from public, anon;
grant execute on function public.set_retention_settings(uuid, integer) to authenticated;

create table public.github_webhook_retries (
  id              uuid primary key default gen_random_uuid(),
  delivery_id     text not null unique check (delivery_id ~ '^[A-Za-z0-9-]{8,80}$'),
  event           text not null check (event in ('installation', 'installation_repositories')),
  action          text check (action is null or char_length(action) <= 60),
  github_installation_id bigint not null check (github_installation_id > 0),
  removed_repository_ids bigint[] not null default '{}'::bigint[] check (cardinality(removed_repository_ids) <= 500),
  status          text not null default 'pending' check (status in ('pending', 'done', 'dead')),
  attempts        integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error_category text check (last_error_category is null or last_error_category ~ '^[a-z_]{1,40}$'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index github_webhook_retries_due_idx on public.github_webhook_retries (next_attempt_at) where status = 'pending';
alter table public.github_webhook_retries enable row level security;
revoke all on public.github_webhook_retries from public, anon, authenticated;

create or replace function gateway.webhook_retry_enqueue(
  p_delivery text, p_event text, p_action text, p_installation bigint, p_removed bigint[])
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.github_webhook_retries (delivery_id, event, action, github_installation_id, removed_repository_ids)
  values (p_delivery, p_event, p_action, p_installation, coalesce(p_removed, '{}'::bigint[]))
  on conflict (delivery_id) do nothing;
  return 'queued';
end;
$fn$;
revoke all on function gateway.webhook_retry_enqueue(text, text, text, bigint, bigint[]) from public;
grant execute on function gateway.webhook_retry_enqueue(text, text, text, bigint, bigint[]) to authority_gateway;

create or replace function gateway.webhook_retry_due(p_limit integer)
returns table (r_delivery_id text, r_event text, r_action text, r_installation bigint, r_removed bigint[], r_attempts integer)
language sql
security definer
set search_path = ''
as $$
  select w.delivery_id, w.event, w.action, w.github_installation_id, w.removed_repository_ids, w.attempts
  from public.github_webhook_retries w
  where w.status = 'pending' and w.next_attempt_at <= now()
  order by w.next_attempt_at
  limit greatest(least(coalesce(p_limit, 25), 100), 1);
$$;
revoke all on function gateway.webhook_retry_due(integer) from public;
grant execute on function gateway.webhook_retry_due(integer) to authority_gateway;

-- Exponential backoff (1, 2, 4 ... minutes), dead after 8 failed attempts so a poison delivery cannot loop forever.
create or replace function gateway.webhook_retry_mark(p_delivery text, p_ok boolean, p_error text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_attempts integer;
begin
  update public.github_webhook_retries w set
      attempts = w.attempts + 1,
      status = case when p_ok then 'done' when w.attempts + 1 >= 8 then 'dead' else 'pending' end,
      next_attempt_at = now() + make_interval(mins => least(power(2, w.attempts)::integer, 60)),
      last_error_category = case when p_ok then null else left(regexp_replace(coalesce(p_error, 'error'), '[^a-z_]', '', 'g'), 40) end,
      updated_at = now()
    where w.delivery_id = p_delivery and w.status = 'pending'
    returning w.attempts into v_attempts;
  return case when v_attempts is null then 'not_pending' when p_ok then 'done' else 'retry' end;
end;
$fn$;
revoke all on function gateway.webhook_retry_mark(text, boolean, text) from public;
grant execute on function gateway.webhook_retry_mark(text, boolean, text) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 4. Installations that need re-verification against GitHub (permission drift is otherwise only noticed on a webhook).
-- ---------------------------------------------------------------------------
create or replace function gateway.github_installations_due(p_age_seconds integer, p_limit integer)
returns table (i_row_id uuid, i_tenant_id uuid, i_github_installation_id bigint)
language sql
security definer
set search_path = ''
as $$
  select gi.id, gi.tenant_id, gi.github_installation_id
  from public.github_installations gi
  where gi.mode = 'live' and gi.status <> 'disconnected'
    and (gi.last_verified_at is null or gi.last_verified_at < now() - make_interval(secs => greatest(coalesce(p_age_seconds, 3600), 60)))
  order by gi.last_verified_at nulls first
  limit greatest(least(coalesce(p_limit, 20), 100), 1);
$$;
revoke all on function gateway.github_installations_due(integer, integer) from public;
grant execute on function gateway.github_installations_due(integer, integer) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 5. The purge itself. SECURITY DEFINER (owner: postgres) so it may use the same audited escape hatch the append-only
--    guard already recognises; executable only by the gateway login.
-- ---------------------------------------------------------------------------
create or replace function gateway.retention_purge(p_limit integer)
returns table (rp_campaigns integer, rp_webhook_deliveries integer, rp_webhook_retries integer, rp_environments integer)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_lim integer := greatest(least(coalesce(p_limit, 200), 1000), 1);
  v_c integer; v_d integer; v_r integer; v_e integer;
begin
  perform set_config('authority.allow_demo_purge', 'on', true);

  with due as (
    select c.id from public.validation_campaigns c
    left join public.tenant_retention_settings s on s.tenant_id = c.tenant_id
    where c.finished_at is not null
      and c.finished_at < now() - make_interval(days => coalesce(s.validation_days, 30))
    order by c.finished_at limit v_lim)
  delete from public.validation_campaigns where id in (select id from due);
  get diagnostics v_c = row_count;

  with due as (select delivery_id from public.github_webhook_deliveries where received_at < now() - interval '90 days' limit v_lim)
  delete from public.github_webhook_deliveries where delivery_id in (select delivery_id from due);
  get diagnostics v_d = row_count;

  delete from public.github_webhook_retries where status in ('done', 'dead') and updated_at < now() - interval '14 days';
  get diagnostics v_r = row_count;

  delete from public.validation_environments e
    where e.expires_at < now() - interval '7 days'
      and not exists (select 1 from public.validation_campaigns c where c.environment_id = e.id);
  get diagnostics v_e = row_count;

  perform set_config('authority.allow_demo_purge', 'off', true);
  return query select v_c, v_d, v_r, v_e;
end;
$fn$;
revoke all on function gateway.retention_purge(integer) from public;
grant execute on function gateway.retention_purge(integer) to authority_gateway;
