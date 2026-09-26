-- Part 4: agent runtime credentials.
--
-- Distinct entirely from Supabase Auth: an agent calling the runtime
-- authorization endpoint has no session, no auth.uid(), and no cookie. It
-- authenticates with a long-lived, high-entropy secret whose SHA-256 hash is
-- the only thing ever stored — the plaintext is generated once, returned
-- once, in create_agent_credential()'s result set, and is never persisted or
-- retrievable again. SHA-256 (not bcrypt/argon2) is appropriate here because
-- the secret is generated with gen_random_bytes(32), never a human-chosen
-- password: it already carries 256 bits of entropy, so a slow KDF would only
-- defend against a threat — offline brute force of a weak secret — that does
-- not apply.

create type public.agent_credential_status as enum ('active', 'revoked');

create table public.agent_credentials (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  agent_id    uuid not null,
  -- "authority_rk_" + 8 lowercase-hex characters: enough to identify a key
  -- operationally (audit logs, "which key is this") without narrowing the
  -- brute-force space of the secret, which carries 256 bits beyond this
  -- prefix.
  key_prefix  text not null check (key_prefix ~ '^authority_rk_[0-9a-f]{8}$'),
  key_hash    text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  status      public.agent_credential_status not null default 'active',
  created_at  timestamptz not null default now(),
  created_by_principal_id uuid,
  revoked_at  timestamptz,
  revoked_by_principal_id uuid,
  revocation_reason text check (revocation_reason is null or char_length(revocation_reason) <= 2000),
  last_used_at timestamptz,
  unique (id, tenant_id),
  unique (key_hash),
  foreign key (agent_id, tenant_id) references public.agents (id, tenant_id),
  foreign key (created_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  foreign key (revoked_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  check ((status = 'revoked') = (revoked_at is not null)),
  check (status = 'active' or revocation_reason is not null)
);

comment on table public.agent_credentials is
  'Per-agent runtime secrets for the /api/v1/authorize endpoint. Only a '
  'SHA-256 hash is stored; the plaintext exists only inside '
  'create_agent_credential()''s single return value, never again. No '
  'authenticated role can INSERT, UPDATE or DELETE this table directly — '
  'see the RPCs added in 20260927000005. key_hash is withheld from every '
  'role at the column-privilege level below, regardless of RLS.';

create index agent_credentials_tenant_agent_idx on public.agent_credentials (tenant_id, agent_id);

alter table public.agent_credentials enable row level security;

-- Sensitive: only security_admin+ may see that a credential exists at all
-- (its prefix, status, last use) — the same tier this project already uses
-- for approvals and contract revocation.
create policy "agent_credentials_select_by_security_admin_and_above"
  on public.agent_credentials for select to authenticated
  using (authz.has_min_role(tenant_id, 'security_admin'));

revoke all on public.agent_credentials from public, anon, authenticated;
grant select (
  id, tenant_id, agent_id, key_prefix, status, created_at, created_by_principal_id,
  revoked_at, revoked_by_principal_id, revocation_reason, last_used_at
) on public.agent_credentials to authenticated;
