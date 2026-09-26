-- Part 4: issuing and revoking agent runtime credentials.
--
-- Both RPCs run under a normal authenticated human session (a developer or
-- security_admin managing an agent from the dashboard) — this is the only
-- part of Part 4's credential lifecycle that uses Supabase Auth at all. The
-- credential these mint is what later lets the *agent* call
-- authorize_tool_call() with no session at all.

create or replace function public.create_agent_credential(p_agent_id uuid)
returns table (credential_id uuid, key_prefix text, plaintext_secret text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_principal_id uuid;
  v_secret_body text;
  v_plaintext text;
  v_prefix text;
  v_hash text;
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'create_agent_credential() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into v_tenant_id from public.agents where id = p_agent_id;
  if v_tenant_id is null then
    raise exception 'agent not found' using errcode = 'P0002';
  end if;

  if not authz.has_min_role(v_tenant_id, 'developer') then
    raise exception 'insufficient privileges to issue a runtime credential for this agent' using errcode = '42501';
  end if;

  select p.id into v_principal_id
  from public.principals p
  where p.tenant_id = v_tenant_id and p.user_id = (select auth.uid());

  v_secret_body := encode(gen_random_bytes(32), 'hex');
  v_plaintext := 'authority_rk_' || v_secret_body;
  v_prefix := left(v_plaintext, 21);
  v_hash := encode(digest(v_plaintext, 'sha256'), 'hex');

  insert into public.agent_credentials (tenant_id, agent_id, key_prefix, key_hash, created_by_principal_id)
  values (v_tenant_id, p_agent_id, v_prefix, v_hash, v_principal_id)
  returning id into v_id;

  return query select v_id, v_prefix, v_plaintext;
end;
$fn$;

revoke all on function public.create_agent_credential(uuid) from public, anon;
grant execute on function public.create_agent_credential(uuid) to authenticated;

create or replace function public.revoke_agent_credential(p_credential_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
  v_status public.agent_credential_status;
  v_principal_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'revoke_agent_credential() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id, status into v_tenant_id, v_status
  from public.agent_credentials where id = p_credential_id;

  if v_tenant_id is null then
    raise exception 'credential not found' using errcode = 'P0002';
  end if;

  if not authz.has_min_role(v_tenant_id, 'security_admin') then
    raise exception 'insufficient privileges to revoke this credential' using errcode = '42501';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) < 1 then
    raise exception 'a revocation reason is required' using errcode = '22023';
  end if;

  if v_status = 'revoked' then
    return;
  end if;

  select p.id into v_principal_id
  from public.principals p
  where p.tenant_id = v_tenant_id and p.user_id = (select auth.uid());

  update public.agent_credentials
  set status = 'revoked', revoked_at = now(), revoked_by_principal_id = v_principal_id,
      revocation_reason = btrim(p_reason)
  where id = p_credential_id;
end;
$fn$;

revoke all on function public.revoke_agent_credential(uuid, text) from public, anon;
grant execute on function public.revoke_agent_credential(uuid, text) to authenticated;
