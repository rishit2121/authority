-- Part 2B.1: product-domain enums and the JSONB schema-version helper.
--
-- Reuses `tenant_environment` from Part 2A for `agents.environment` rather
-- than declaring a second copy of "development/staging/production". No
-- existing enum is altered.

create type public.agent_status as enum ('active', 'paused', 'revoked');
create type public.agent_risk_tier as enum ('low', 'medium', 'high');

create type public.task_status as enum (
  'pending',
  'contract_issued',
  'executing',
  'awaiting_approval',
  'completed',
  'failed',
  'terminated'
);

create type public.contract_status as enum ('draft', 'active', 'superseded');
create type public.plan_status as enum ('proposed', 'superseded');
create type public.plan_node_status as enum ('proposed', 'allowed', 'rejected', 'executed', 'skipped');

create type public.semantic_decision_state as enum ('ok', 'timeout', 'error');

create type public.authorization_outcome as enum (
  'allow',
  'allow_constrained',
  'replan',
  'clarify',
  'require_approval',
  'deny'
);

create type public.capability_status as enum ('active', 'expired', 'revoked', 'consumed');
create type public.approval_status as enum ('pending', 'approved', 'rejected', 'expired');

create type public.execution_event_type as enum (
  'task_received',
  'contract_issued',
  'plan_proposed',
  'request_evaluated',
  'capability_issued',
  'tool_invoked',
  'tool_failed',
  'approval_requested',
  'approval_resolved',
  'capability_revoked',
  'task_completed',
  'task_terminated'
);
create type public.execution_outcome as enum ('success', 'failure', 'blocked', 'info');

create type public.policy_status as enum ('draft', 'active', 'archived');
create type public.policy_effect as enum ('allow', 'deny');

create type public.integration_provider as enum (
  'github',
  'stripe',
  'gmail',
  'postgres',
  'slack',
  'salesforce'
);
create type public.integration_status as enum ('connected', 'warning', 'not_connected');

create type public.principal_kind as enum ('human', 'service');

-- See supabase/JSONB_VERSIONING.md. Every flexible JSONB column in the
-- product schema is checked against this at write time — a row carrying an
-- unversioned or unrecognized-version payload cannot be inserted at all.
create or replace function authz.has_allowed_schema_version(p_payload jsonb, p_allowed integer[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_payload ->> 'schemaVersion')::integer = any (p_allowed);
$$;

revoke all on function authz.has_allowed_schema_version(jsonb, integer[]) from public, anon;
grant execute on function authz.has_allowed_schema_version(jsonb, integer[]) to authenticated;
