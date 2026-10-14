-- Platform-wide usage metrics for the operator dashboard (/app/admin).
--
-- Aggregates across every tenant, so it cannot run under tenant RLS: it is a
-- SECURITY DEFINER function callable only by the gateway role, and the page
-- that calls it is gated to PLATFORM_ADMIN_EMAILS server-side. It returns
-- counts and a short list of recent signups (email, date, setup progress) --
-- never credentials, connection names, task content, or arguments.
--
-- Test and fixture traffic is excluded so the numbers mean real people:
-- accounts on the reserved @authority.test domain (every seed, integration
-- and e2e account uses it), Validation Lab sandbox tenants, and anything
-- belonging only to those.

create or replace function gateway.platform_metrics()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with real_users as (
    select u.id, u.email, u.created_at, u.email_confirmed_at, u.last_sign_in_at
    from auth.users u
    where u.email is not null
      and u.email not ilike '%@authority.test'
      and not coalesce(u.is_anonymous, false)
  ),
  real_tenants as (
    select t.id, t.created_by, t.created_at
    from public.tenants t
    where not t.validation_sandbox
      and t.created_by in (select id from real_users)
  ),
  tenant_progress as (
    select
      t.id,
      t.created_by,
      exists (
        select 1 from public.connector_connections c
        where c.tenant_id = t.id and c.status <> 'disconnected'
      ) or exists (
        select 1 from public.github_installations g
        where g.tenant_id = t.id and g.status <> 'disconnected'
      ) as has_connection,
      exists (select 1 from public.agents a where a.tenant_id = t.id) as has_agent,
      exists (select 1 from public.authorization_decisions d where d.tenant_id = t.id) as has_call,
      exists (
        select 1 from public.authorization_decisions d
        where d.tenant_id = t.id and d.created_at > now() - interval '7 days'
      ) as active_7d
    from real_tenants t
  ),
  days as (
    select d::date as day
    from pg_catalog.generate_series(current_date - 29, current_date, interval '1 day') as d
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'users', jsonb_build_object(
      'total', (select count(*) from real_users),
      'confirmed', (select count(*) from real_users where email_confirmed_at is not null),
      'last7d', (select count(*) from real_users where created_at > now() - interval '7 days'),
      'last30d', (select count(*) from real_users where created_at > now() - interval '30 days'),
      'signedIn7d', (select count(*) from real_users where last_sign_in_at > now() - interval '7 days')
    ),
    'workspaces', jsonb_build_object(
      'total', (select count(*) from tenant_progress),
      'withConnection', (select count(*) from tenant_progress where has_connection),
      'withAgent', (select count(*) from tenant_progress where has_agent),
      'withCall', (select count(*) from tenant_progress where has_call),
      'active7d', (select count(*) from tenant_progress where active_7d)
    ),
    'calls', jsonb_build_object(
      'authorized7d', (
        select count(*) from public.authorization_decisions d
        where d.tenant_id in (select id from real_tenants) and d.created_at > now() - interval '7 days'
      ),
      'authorized30d', (
        select count(*) from public.authorization_decisions d
        where d.tenant_id in (select id from real_tenants) and d.created_at > now() - interval '30 days'
      ),
      'executed7d', (
        select count(*) from public.connector_execution_receipts r
        where r.tenant_id in (select id from real_tenants) and r.created_at > now() - interval '7 days'
      ) + (
        select count(*) from public.github_execution_receipts r
        where r.tenant_id in (select id from real_tenants) and r.created_at > now() - interval '7 days'
      )
    ),
    'connectionsByService', (
      select coalesce(jsonb_object_agg(service, n), '{}'::jsonb)
      from (
        select
          case
            when c.connector_id like 'custom\_%' then 'custom_api'
            when c.connector_id like 'postgres\_%' then 'postgres'
            else c.connector_id
          end as service,
          count(*) as n
        from public.connector_connections c
        where c.tenant_id in (select id from real_tenants) and c.status <> 'disconnected'
        group by 1
      ) s
    ),
    'signupsByDay', (
      select jsonb_agg(jsonb_build_object(
        'day', days.day,
        'count', (select count(*) from real_users u where u.created_at::date = days.day)
      ) order by days.day)
      from days
    ),
    'callsByDay', (
      select jsonb_agg(jsonb_build_object(
        'day', days.day,
        'count', (
          select count(*) from public.authorization_decisions d
          where d.tenant_id in (select id from real_tenants) and d.created_at::date = days.day
        )
      ) order by days.day)
      from days
    ),
    'recentSignups', (
      select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r."createdAt" desc), '[]'::jsonb)
      from (
        select
          u.email,
          u.created_at as "createdAt",
          u.email_confirmed_at is not null as confirmed,
          coalesce(bool_or(p.has_connection), false) as "hasConnection",
          coalesce(bool_or(p.has_agent), false) as "hasAgent",
          coalesce(bool_or(p.has_call), false) as "hasCall"
        from real_users u
        left join tenant_progress p on p.created_by = u.id
        group by u.id, u.email, u.created_at, u.email_confirmed_at
        order by u.created_at desc
        limit 25
      ) r
    )
  );
$$;

revoke all on function gateway.platform_metrics() from public, anon, authenticated;
grant execute on function gateway.platform_metrics() to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261013000001'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
