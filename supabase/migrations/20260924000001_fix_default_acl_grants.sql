-- Security correction: the Supabase platform grants `ALTER DEFAULT
-- PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated, service_role`
-- for the public schema at project provisioning. Every migration that
-- creates a table therefore starts with `authenticated` already holding
-- full INSERT/UPDATE/DELETE, regardless of any later `grant` statement — a
-- `grant select` is additive, not a replacement, unless the pre-existing
-- grant is revoked first.
--
-- Part 2A's migrations revoked from *both* `anon` and `authenticated` before
-- re-granting (see 20260922000001_auth_tenancy_schema.sql) and are correct.
-- The thirteen Part 2B.1 product-table migrations
-- (20260923000002-000006) only revoked from `anon`, leaving
-- `authenticated`'s automatic grant in place on every one of them. Verified
-- directly against this project: every one of the 13 tables showed
-- `authenticated` holding DELETE, INSERT, REFERENCES, SELECT, TRIGGER,
-- TRUNCATE and UPDATE — the full default set — rather than the narrow
-- per-table grant each table's own migration intended.
--
-- This was not exploitable: Postgres RLS denies any command with no
-- applicable policy regardless of the underlying grant, and every one of
-- these tables' RLS policies were already scoped exactly as documented — a
-- normal authenticated client could not, and cannot, insert a capability or
-- an authorization decision, verified directly both before and after this
-- migration. But relying on RLS's default-deny to cover a privilege-layer
-- mistake is not the intended design: least privilege means the grant
-- itself should reflect exactly what each table's write-path classification
-- allows, independent of what RLS separately happens to permit. This
-- migration corrects the grant layer to match the intent every affected
-- table's own migration already documented.
--
-- `anon` is included in the revoke below for symmetry and defense in depth
-- even though it was already correctly empty on every one of these tables.

revoke all on table public.principals from anon, authenticated;
grant select on table public.principals to authenticated;

revoke all on table public.agents from anon, authenticated;
grant select, insert, update on table public.agents to authenticated;

revoke all on table public.tasks from anon, authenticated;
grant select on table public.tasks to authenticated;

revoke all on table public.task_authority_contracts from anon, authenticated;
grant select on table public.task_authority_contracts to authenticated;

revoke all on table public.plans from anon, authenticated;
grant select on table public.plans to authenticated;

revoke all on table public.plan_nodes from anon, authenticated;
grant select on table public.plan_nodes to authenticated;

revoke all on table public.tool_requests from anon, authenticated;
grant select on table public.tool_requests to authenticated;

revoke all on table public.semantic_decisions from anon, authenticated;
grant select on table public.semantic_decisions to authenticated;

revoke all on table public.authorization_decisions from anon, authenticated;
grant select on table public.authorization_decisions to authenticated;

revoke all on table public.capabilities from anon, authenticated;
grant select on table public.capabilities to authenticated;

revoke all on table public.approvals from anon, authenticated;
grant select, update on table public.approvals to authenticated;

revoke all on table public.execution_events from anon, authenticated;
grant select on table public.execution_events to authenticated;

revoke all on table public.policies from anon, authenticated;
grant select, insert, update on table public.policies to authenticated;

revoke all on table public.integrations from anon, authenticated;
grant select, insert, update on table public.integrations to authenticated;
