-- Part 2B.1: indexes for the common tenant-scoped access paths.
--
-- Postgres does not automatically index foreign-key columns, so every
-- composite FK added in the preceding migrations gets an index here for join
-- performance, plus the specific access patterns the dashboard and task
-- investigation view are known to need.
--
-- No JSONB (GIN) indexes are added in this phase: nothing yet queries *into*
-- a versioned JSONB column's contents — every current read filters on the
-- first-class columns beside it (tool, operation, resource, status, etc.).
-- Add one only when a specific query needs it, scoped to the exact path
-- expression it serves.

-- Agents
create index agents_tenant_created_at_idx on public.agents (tenant_id, created_at desc);
create index agents_tenant_owner_idx on public.agents (tenant_id, owner_principal_id);
create index agents_tenant_status_idx on public.agents (tenant_id, status);

-- Tasks
create index tasks_tenant_created_at_idx on public.tasks (tenant_id, created_at desc);
create index tasks_tenant_status_idx on public.tasks (tenant_id, status);
create index tasks_tenant_agent_idx on public.tasks (tenant_id, agent_id);
create index tasks_tenant_principal_idx on public.tasks (tenant_id, principal_id);

-- Contracts
create index contracts_tenant_task_idx on public.task_authority_contracts (tenant_id, task_id);

-- Plans
create index plans_tenant_task_idx on public.plans (tenant_id, task_id);

-- Plan nodes: "plan nodes by plan" is the primary access path for rendering
-- one plan's steps in order.
create index plan_nodes_tenant_plan_sequence_idx
  on public.plan_nodes (tenant_id, plan_id, sequence_no);

-- Tool requests
create index tool_requests_tenant_task_idx on public.tool_requests (tenant_id, task_id);
create index tool_requests_tenant_plan_node_idx
  on public.tool_requests (tenant_id, plan_node_id) where plan_node_id is not null;

-- Semantic decisions
create index semantic_decisions_tenant_task_idx on public.semantic_decisions (tenant_id, task_id);
create index semantic_decisions_tenant_request_idx
  on public.semantic_decisions (tenant_id, tool_request_id);

-- Authorization decisions: "decisions by task or request" plus the
-- dashboard's recency ordering.
create index authorization_decisions_tenant_task_idx
  on public.authorization_decisions (tenant_id, task_id, created_at desc);
create index authorization_decisions_tenant_request_idx
  on public.authorization_decisions (tenant_id, tool_request_id);
create index authorization_decisions_tenant_created_at_idx
  on public.authorization_decisions (tenant_id, created_at desc);

-- Capabilities: "active capabilities and expiry" is the dashboard's overview
-- metric and the task investigation view's live-capability list.
create index capabilities_tenant_task_idx on public.capabilities (tenant_id, task_id);
create index capabilities_active_expiry_idx
  on public.capabilities (tenant_id, expires_at)
  where status = 'active';

-- Approvals: "pending approvals" backs both the dashboard metric and the
-- approvals page.
create index approvals_tenant_task_idx on public.approvals (tenant_id, task_id);
create index approvals_pending_idx
  on public.approvals (tenant_id, requested_at desc)
  where status = 'pending';

-- Execution events: "task and event time" is the task investigation view's
-- timeline query — the one most likely to accumulate unbounded rows, hence
-- the descending order to serve "most recent N" directly from the index.
create index execution_events_task_created_at_idx
  on public.execution_events (tenant_id, task_id, created_at desc);
create index execution_events_tenant_created_at_idx
  on public.execution_events (tenant_id, created_at desc);

-- Policies
create index policies_tenant_status_idx on public.policies (tenant_id, status);

-- Integrations
create index integrations_tenant_status_idx on public.integrations (tenant_id, status);

-- Principals
create index principals_tenant_created_at_idx on public.principals (tenant_id, created_at desc);
