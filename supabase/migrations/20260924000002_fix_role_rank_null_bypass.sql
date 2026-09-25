-- Critical fix: authz.role_rank() returned NULL for a non-member instead of
-- a sentinel below every real rank, and PL/pgSQL's `IF NOT <expr> THEN`
-- treats a NULL-valued condition as false — meaning `IF NOT NULL THEN RAISE`
-- never raises. Three RPCs used exactly this pattern:
-- install_demo_workspace(), reset_demo_workspace() and terminate_task().
--
-- Concretely: authz.current_role_in(tenant_id) returns NULL for a caller
-- with no membership in that tenant at all (as designed — there is no role
-- to report). That NULL then propagated through role_rank() unchanged
-- rather than being floored, so `role_rank(NULL) >= role_rank('developer')`
-- evaluated to NULL rather than false, and `if not authz.has_min_role(...)
-- then raise exception` never raised for a caller who is a stranger to the
-- tenant — as opposed to a member holding an insufficient role, which
-- returns a real (non-null) rank and correctly raises.
--
-- Verified exploitable before this fix: signed in as tenant B's owner (zero
-- membership in tenant A), `terminate_task()` on a real tenant A task id
-- returned success with no exception — the authorization check was
-- silently skipped. The task's on-disk state was unaffected only because
-- that verification ran inside a transaction that was then rolled back for
-- the test itself, not because the function declined to act.
--
-- This is *not* an RLS-policy bug: every RLS policy using has_min_role()/
-- can_manage_tenant() (agents_insert_by_developer_and_above,
-- tenants_update_by_managers, etc.) was already safe, because a NULL result
-- from a USING/WITH CHECK expression is treated identically to false by
-- Postgres's row-security evaluation — unlike PL/pgSQL's IF statement. The
-- bug was confined to the three SECURITY DEFINER functions that re-derive
-- this same boolean inside an explicit `IF NOT ... THEN RAISE`.
--
-- Fix: role_rank() now returns 0 — below every real role's rank (viewer=10
-- is the lowest) — for NULL or any unrecognized input, via an explicit ELSE
-- rather than an implicit NULL fallthrough. This makes every caller
-- (has_min_role, can_manage_tenant, and any future one) correctly produce a
-- real `false`, not `NULL`, for a non-member — fixing the root cause once
-- rather than patching each of the three call sites separately.

create or replace function authz.role_rank(p_role public.tenant_role)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'viewer'         then 10
    when 'developer'      then 20
    when 'security_admin' then 30
    when 'admin'          then 40
    when 'owner'          then 50
    else 0
  end;
$$;

-- Re-grant: CREATE OR REPLACE FUNCTION preserves existing grants in
-- PostgreSQL, but re-stated here so this migration's privilege posture is
-- self-evident without cross-referencing an earlier file.
revoke all on function authz.role_rank(public.tenant_role) from public, anon;
grant execute on function authz.role_rank(public.tenant_role) to authenticated;
