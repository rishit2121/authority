-- Schema-inventory guardrails.
--
-- Unlike every other suite in this directory, these assertions are written
-- against `pg_catalog`/`information_schema` directly rather than a fixed
-- list of table names, so they automatically cover any table added to the
-- public schema in the future — including one nobody remembers to add RLS
-- to, or one whose write privileges outrun its policies the way the Part
-- 2B.1 product tables briefly did (see 20260924000001_fix_default_acl_
-- grants.sql). This suite exists specifically because that defect was real:
-- test 3 below would have failed the moment those thirteen tables were
-- created, instead of surfacing only when someone went looking for it.

select plan(4);

-- `tap_out` is this test harness's own scratch table (see the PRELUDE in
-- scripts/db-test.mjs) — created fresh inside this suite's own transaction
-- to collect TAP output, not an application table, and excluded from every
-- check below for that reason alone.

-- 1. Every ordinary table in the public schema has row level security
-- enabled. A future migration that creates a table and forgets `enable row
-- level security` fails this immediately.
select t(is(
  (select count(*)::int from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
     and c.relname <> 'tap_out'),
  0,
  'every table in the public schema has row level security enabled'
));

-- 2. anon holds no table privilege anywhere in the public schema — the
-- architectural invariant this project follows throughout: unauthenticated
-- access is denied at the privilege layer, not left to RLS alone.
select t(is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon' and table_name <> 'tap_out'),
  0,
  'anon holds no table privilege anywhere in the public schema'
));

-- 3. Every INSERT/UPDATE/DELETE privilege `authenticated` holds on any
-- public table is backed by at least one policy for that exact command.
-- This is the specific check that would have caught the Part 2B.1 grant
-- defect: those thirteen tables held INSERT/UPDATE/DELETE via the
-- Supabase platform's default ACL with zero matching policies, meaning
-- RLS's default-deny was silently the only thing enforcing "no writes" —
-- correct in effect, wrong as a design to rely on, and invisible to any
-- test that only ever tries the denied operation and calls it proven safe.
select t(is(
  (
    select count(*)::int
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.grantee = 'authenticated'
      and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      and g.table_name <> 'tap_out'
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = g.table_name
          and p.cmd::text in (g.privilege_type, 'ALL')
          and 'authenticated' = any (p.roles)
      )
  ),
  0,
  'every authenticated INSERT/UPDATE/DELETE grant is backed by a matching policy'
));

-- 4. No policy anywhere in the public schema uses an unconditional
-- using(true) or with_check(true).
select t(is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and (qual = 'true' or with_check = 'true')),
  0,
  'no policy in the public schema uses an unconditional using(true) or with_check(true)'
));
