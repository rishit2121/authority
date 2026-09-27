-- Part 7: a real signed-in member has no guaranteed `principals` row, so the installation and binding
-- functions treated a legitimate owner as "forbidden". The gateway now creates the caller's own human
-- principal on first use — only for a user who is already a member of the tenant (role is checked by the
-- callers before/after; this never grants a role). Additive: existing principals are untouched.

create or replace function gateway.actor_principal(p_tenant_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_name text;
begin
  if not exists (select 1 from public.tenant_memberships m where m.tenant_id = p_tenant_id and m.user_id = p_user_id) then
    return null;
  end if;
  select p.id into v_id from public.principals p
  where p.tenant_id = p_tenant_id and p.user_id = p_user_id order by p.created_at, p.id limit 1;
  if v_id is not null then return v_id; end if;

  select coalesce(nullif(btrim(pr.display_name), ''), nullif(split_part(u.email, '@', 1), ''), 'Member')
    into v_name
  from auth.users u left join public.profiles pr on pr.user_id = u.id where u.id = p_user_id;

  insert into public.principals (tenant_id, kind, display_name, email, user_id)
  select p_tenant_id, 'human', left(coalesce(v_name, 'Member'), 200), u.email, p_user_id
  from auth.users u where u.id = p_user_id
  returning id into v_id;
  return v_id;
end;
$fn$;
revoke all on function gateway.actor_principal(uuid, uuid) from public;
grant execute on function gateway.actor_principal(uuid, uuid) to authority_gateway;
