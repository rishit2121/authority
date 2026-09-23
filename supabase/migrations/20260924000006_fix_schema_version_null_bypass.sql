-- Security review finding: authz.has_allowed_schema_version() returned SQL
-- NULL, not false, when a payload's `schemaVersion` key was absent — and a
-- table CHECK constraint treats NULL as satisfied, the opposite of RLS's
-- USING/WITH CHECK convention where NULL means deny. This is the same class
-- of bug as the role_rank NULL-bypass fixed in
-- 20260924000002_fix_role_rank_null_bypass.sql — a boolean-returning helper
-- silently passing on NULL in the one calling context where NULL isn't
-- treated as a rejection — found by searching for that exact pattern class
-- across every boolean SQL function, not just role_rank().
--
-- Verified exploitable directly: signed in as tenant A's owner (security_admin
-- and above may INSERT/UPDATE `policies` directly under RLS — see
-- 20260923000008_product_rls.sql), an INSERT of
-- `conditions = '{}'::jsonb` (no schemaVersion key at all) into `policies`
-- succeeded, despite the migration comment's explicit claim that "a row
-- carrying an unversioned or unrecognized-version payload cannot be inserted
-- at all." A payload with a *present but unrecognized* version, e.g.
-- `{"schemaVersion":99}`, was correctly rejected the whole time — the gap is
-- specific to a missing key, not a wrong value.
--
-- Blast radius: every JSONB column this helper guards is affected in
-- principle, but the only ones actually reachable by a direct client
-- INSERT/UPDATE (as opposed to only through a SECURITY DEFINER RPC that
-- always writes a valid, hardcoded schemaVersion) are `policies.conditions`
-- (security_admin+) and `integrations.configured_scopes_metadata` /
-- `health_metadata` (admin+). The application's own mapper layer
-- (`readVersionedJson` in `src/lib/persistence/versioned-json.ts`)
-- independently rejects a payload with a missing/unrecognized version on
-- read, so a malformed row could not have been silently trusted by the app —
-- but the database no longer enforcing its own documented invariant is a
-- real defect in its own right, and defense-in-depth means both layers
-- should hold, not just one.
--
-- Fix: wrap the comparison in coalesce(..., false), mirroring role_rank's
-- explicit ELSE. A NULL extracted version (payload has no `schemaVersion` key
-- at all, or the key holds something that cannot cast to integer and the
-- ->> operator itself yields NULL for a missing key) now correctly fails the
-- check rather than passing it.

create or replace function authz.has_allowed_schema_version(p_payload jsonb, p_allowed integer[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((p_payload ->> 'schemaVersion')::integer = any (p_allowed), false);
$$;

revoke all on function authz.has_allowed_schema_version(jsonb, integer[]) from public, anon;
grant execute on function authz.has_allowed_schema_version(jsonb, integer[]) to authenticated;
