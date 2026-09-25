-- Part 2B.1: row level security for every product table.
--
-- Read model, uniform across all thirteen tables: any member of the tenant
-- can SELECT every row in it. `anon` is granted nothing at all, so
-- unauthenticated access fails on privileges before RLS is even consulted —
-- the same pattern Part 2A established for profiles/tenants/memberships.
--
-- Write model, by table classification (see the migration headers above for
-- the full reasoning):
--
--   agents        -- developer+ INSERT/UPDATE (user-editable configuration)
--   policies      -- security_admin+ INSERT/UPDATE, RLS + trigger both block
--                    any change once a row is active (draft-only editing)
--   integrations  -- admin+ INSERT/UPDATE (metadata only, no credentials)
--   approvals     -- security_admin+ UPDATE only (resolving an approval);
--                    no INSERT grant to any authenticated role
--   everything else (tasks, contracts, plans, plan_nodes, tool_requests,
--   semantic_decisions, authorization_decisions, capabilities, principals,
--   execution_events) -- SELECT only. Privileges make it impossible for any
--   client, regardless of role, to write to these tables directly: the
--   demo installer and terminate_task() RPC (both SECURITY DEFINER, added in
--   20260923000009) are the only write paths that exist in this phase.
--   authorization_decisions and execution_events are additionally
--   append-only even to those RPCs' own logic — see their INSERT-only
--   comments below.
--
-- No policy in this file uses `using (true)`.

create or replace function authz.has_min_role(p_tenant_id uuid, p_min_role public.tenant_role)
returns boolean
language sql
stable
set search_path = ''
as $$
  select authz.role_rank(authz.current_role_in(p_tenant_id)) >= authz.role_rank(p_min_role);
$$;

revoke all on function authz.has_min_role(uuid, public.tenant_role) from public, anon;
grant execute on function authz.has_min_role(uuid, public.tenant_role) to authenticated;

-- ---------------------------------------------------------------------------
-- principals — read-only to every authenticated role.
-- ---------------------------------------------------------------------------

alter table public.principals enable row level security;
revoke all on table public.principals from public, anon;
grant select on table public.principals to authenticated;

create policy "principals_select_within_tenant"
  on public.principals for select to authenticated
  using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- agents — developer+ may create and manage; viewer reads only.
-- ---------------------------------------------------------------------------

alter table public.agents enable row level security;
revoke all on table public.agents from public, anon;
grant select, insert, update on table public.agents to authenticated;

create policy "agents_select_within_tenant"
  on public.agents for select to authenticated
  using (authz.is_member_of(tenant_id));

create policy "agents_insert_by_developer_and_above"
  on public.agents for insert to authenticated
  with check (authz.has_min_role(tenant_id, 'developer'));

create policy "agents_update_by_developer_and_above"
  on public.agents for update to authenticated
  using (authz.has_min_role(tenant_id, 'developer'))
  with check (authz.has_min_role(tenant_id, 'developer'));

-- ---------------------------------------------------------------------------
-- tasks, contracts, plans, plan_nodes, tool_requests — read-only.
--
-- Task creation is deliberately not a bare client INSERT policy: a task
-- carries a "trusted objective" that later parts (contract generation) build
-- on, and that belongs behind a narrow server action or RPC once it exists,
-- not a generic row insert. No such RPC exists yet in this phase — task
-- creation is Part 3 scope. Until then, rows exist only via the demo
-- installer.
-- ---------------------------------------------------------------------------

alter table public.tasks enable row level security;
revoke all on table public.tasks from public, anon;
grant select on table public.tasks to authenticated;

create policy "tasks_select_within_tenant"
  on public.tasks for select to authenticated
  using (authz.is_member_of(tenant_id));

alter table public.task_authority_contracts enable row level security;
revoke all on table public.task_authority_contracts from public, anon;
grant select on table public.task_authority_contracts to authenticated;

create policy "contracts_select_within_tenant"
  on public.task_authority_contracts for select to authenticated
  using (authz.is_member_of(tenant_id));

alter table public.plans enable row level security;
revoke all on table public.plans from public, anon;
grant select on table public.plans to authenticated;

create policy "plans_select_within_tenant"
  on public.plans for select to authenticated
  using (authz.is_member_of(tenant_id));

alter table public.plan_nodes enable row level security;
revoke all on table public.plan_nodes from public, anon;
grant select on table public.plan_nodes to authenticated;

create policy "plan_nodes_select_within_tenant"
  on public.plan_nodes for select to authenticated
  using (authz.is_member_of(tenant_id));

alter table public.tool_requests enable row level security;
revoke all on table public.tool_requests from public, anon;
grant select on table public.tool_requests to authenticated;

create policy "tool_requests_select_within_tenant"
  on public.tool_requests for select to authenticated
  using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- semantic_decisions, authorization_decisions — read-only, append-only.
-- ---------------------------------------------------------------------------

alter table public.semantic_decisions enable row level security;
revoke all on table public.semantic_decisions from public, anon;
grant select on table public.semantic_decisions to authenticated;

create policy "semantic_decisions_select_within_tenant"
  on public.semantic_decisions for select to authenticated
  using (authz.is_member_of(tenant_id));

alter table public.authorization_decisions enable row level security;
revoke all on table public.authorization_decisions from public, anon;
grant select on table public.authorization_decisions to authenticated;

create policy "authorization_decisions_select_within_tenant"
  on public.authorization_decisions for select to authenticated
  using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- capabilities — read-only. No capability can be minted by any client
-- insert; the demo installer and terminate_task() are the only writers.
-- ---------------------------------------------------------------------------

alter table public.capabilities enable row level security;
revoke all on table public.capabilities from public, anon;
grant select on table public.capabilities to authenticated;

create policy "capabilities_select_within_tenant"
  on public.capabilities for select to authenticated
  using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- approvals — security_admin+ may resolve (update) an existing approval.
-- No INSERT grant to any authenticated role: approvals are raised only by
-- the evaluation pipeline (future) or the demo installer, never directly.
-- ---------------------------------------------------------------------------

alter table public.approvals enable row level security;
revoke all on table public.approvals from public, anon;
grant select, update on table public.approvals to authenticated;

create policy "approvals_select_within_tenant"
  on public.approvals for select to authenticated
  using (authz.is_member_of(tenant_id));

create policy "approvals_update_by_security_admin_and_above"
  on public.approvals for update to authenticated
  using (authz.has_min_role(tenant_id, 'security_admin'))
  with check (authz.has_min_role(tenant_id, 'security_admin'));

-- ---------------------------------------------------------------------------
-- execution_events — read-only, append-only.
-- ---------------------------------------------------------------------------

alter table public.execution_events enable row level security;
revoke all on table public.execution_events from public, anon;
grant select on table public.execution_events to authenticated;

create policy "execution_events_select_within_tenant"
  on public.execution_events for select to authenticated
  using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- policies — security_admin+ may create and edit drafts. Both the RLS USING
-- clause (old row must still be draft) and the immutability trigger in the
-- next migration independently block any change once activated, so a defect
-- in one layer alone does not make an activated policy editable.
-- ---------------------------------------------------------------------------

alter table public.policies enable row level security;
revoke all on table public.policies from public, anon;
grant select, insert, update on table public.policies to authenticated;

create policy "policies_select_within_tenant"
  on public.policies for select to authenticated
  using (authz.is_member_of(tenant_id));

create policy "policies_insert_by_security_admin_and_above"
  on public.policies for insert to authenticated
  with check (authz.has_min_role(tenant_id, 'security_admin'));

create policy "policies_update_drafts_by_security_admin_and_above"
  on public.policies for update to authenticated
  using (authz.has_min_role(tenant_id, 'security_admin') and status = 'draft')
  with check (authz.has_min_role(tenant_id, 'security_admin'));

-- ---------------------------------------------------------------------------
-- integrations — owner/admin manage metadata; everyone else reads.
-- ---------------------------------------------------------------------------

alter table public.integrations enable row level security;
revoke all on table public.integrations from public, anon;
grant select, insert, update on table public.integrations to authenticated;

create policy "integrations_select_within_tenant"
  on public.integrations for select to authenticated
  using (authz.is_member_of(tenant_id));

create policy "integrations_insert_by_admin_and_above"
  on public.integrations for insert to authenticated
  with check (authz.has_min_role(tenant_id, 'admin'));

create policy "integrations_update_by_admin_and_above"
  on public.integrations for update to authenticated
  using (authz.has_min_role(tenant_id, 'admin'))
  with check (authz.has_min_role(tenant_id, 'admin'));
