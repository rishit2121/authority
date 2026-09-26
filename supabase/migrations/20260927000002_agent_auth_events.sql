-- Part 4: append-only audit trail for every authentication attempt against
-- authorize_tool_call() — including attempts that never resolve to a tenant
-- at all (bad secret, unknown prefix). That is why tenant_id, agent_id and
-- credential_id are nullable here, alone among this project's audit tables:
-- a caller presenting a bogus secret still needs its attempt recorded for
-- rate limiting and operator visibility, even though nothing about who they
-- claim to be has been verified.

create type public.agent_auth_outcome as enum ('success', 'invalid_credential', 'revoked_credential', 'rate_limited');

create table public.agent_auth_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants (id) on delete cascade,
  agent_id    uuid,
  credential_id uuid,
  -- The first 21 characters of whatever secret was presented — exactly the
  -- length of a well-formed "authority_rk_" + 8 hex char prefix. Enough to
  -- correlate repeated failures from the same caller for rate limiting and
  -- operator triage, never enough to reconstruct a genuine secret.
  attempted_key_prefix text check (attempted_key_prefix is null or char_length(attempted_key_prefix) <= 32),
  outcome     public.agent_auth_outcome not null,
  created_at  timestamptz not null default now(),
  foreign key (agent_id, tenant_id) references public.agents (id, tenant_id),
  foreign key (credential_id, tenant_id) references public.agent_credentials (id, tenant_id)
);

comment on table public.agent_auth_events is
  'Append-only. No authenticated role holds UPDATE or DELETE — only '
  'authorize_tool_call() (SECURITY DEFINER) ever inserts. tenant_id/'
  'agent_id/credential_id are null exactly when the presented secret did '
  'not resolve to any known credential.';

create index agent_auth_events_prefix_created_idx
  on public.agent_auth_events (attempted_key_prefix, created_at)
  where attempted_key_prefix is not null;

create index agent_auth_events_tenant_created_idx
  on public.agent_auth_events (tenant_id, created_at) where tenant_id is not null;

alter table public.agent_auth_events enable row level security;

create policy "agent_auth_events_select_by_security_admin_and_above"
  on public.agent_auth_events for select to authenticated
  using (tenant_id is not null and authz.has_min_role(tenant_id, 'security_admin'));

revoke all on public.agent_auth_events from public, anon, authenticated;
grant select on public.agent_auth_events to authenticated;
