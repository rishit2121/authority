-- Approval becomes the organization's call.
--
-- Until now every contract that wrote anything needed a human to activate it
-- (built-in rules in approval-rules.ts), and an API-prepared contract could
-- activate on its own only when every tool it allowed was also on the
-- application's automation allowlist. Now:
--
--  * approval-rules.ts derives a requirement only from the tenant's own
--    approval rules (active `require_approval` policies), so a contract with
--    no matching rule has an empty required_approvals_spec;
--  * activate_task_contract_for_backend activates any such contract -- the
--    automation allowlist is no longer consulted (the table is kept, unused);
--  * admins manage approval rules through two RPCs below. A rule is created
--    active and is retired by archiving it -- the only change an active
--    policy row may ever undergo, and only for require_approval policies.
--
-- Nothing here changes what a contract allows or how a single call is
-- decided at runtime: gateway.evaluate_deterministic is untouched.

-- ---------------------------------------------------------------------------
-- 1. Automatic activation no longer needs an allowlist entry per tool.
-- ---------------------------------------------------------------------------
create or replace function gateway.activate_task_contract_for_backend(p_secret text, p_contract_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text; v_tenant uuid; v_app uuid;
  v_contract_tenant uuid; v_task_id uuid; v_task_customer uuid; v_customer_app uuid;
  v_contract_status public.contract_status;
  v_expires_at timestamptz;
  v_tools text[];
  v_approvals_count integer;
  v_activator_principal_id uuid;
begin
  select rbc_status, rbc_tenant_id, rbc_application_id into v_status, v_tenant, v_app
  from gateway.resolve_backend_credential(p_secret);
  if v_status <> 'ok' then return v_status; end if;

  select tenant_id, task_id, contract_status, expires_at
    into v_contract_tenant, v_task_id, v_contract_status, v_expires_at
  from public.task_authority_contracts where id = p_contract_id;
  if v_contract_tenant is null or v_contract_tenant <> v_tenant then
    return 'not_found';
  end if;

  select customer_id into v_task_customer from public.tasks where id = v_task_id;
  if v_task_customer is null then return 'not_found'; end if;
  select application_id into v_customer_app from public.customers where id = v_task_customer;
  if v_customer_app is null or v_customer_app <> v_app then return 'not_found'; end if;

  if authz.contract_is_currently_active(v_contract_status, v_expires_at) then
    return 'ok';
  end if;

  select
    (select coalesce(array_agg(item ->> 'tool'), '{}') from jsonb_array_elements(tac.allowed_actions -> 'items') as item),
    coalesce(jsonb_array_length(tac.required_approvals_spec -> 'items'), 0)
    into v_tools, v_approvals_count
  from public.task_authority_contracts tac where tac.id = p_contract_id;

  -- A matching approval rule means a person decides; an empty contract has nothing to run.
  if v_approvals_count > 0 or array_length(v_tools, 1) is null then
    return 'not_eligible';
  end if;

  v_activator_principal_id := gateway.ensure_application_service_principal(v_tenant, v_app);

  perform gateway.activate_task_contract_core(p_contract_id, v_activator_principal_id);
  return 'ok';
exception
  when others then
    -- activate_task_contract_core raises on a stale/non-activatable state
    -- (e.g. lost a race to a concurrent activation).
    return 'not_eligible';
end;
$fn$;
revoke all on function gateway.activate_task_contract_for_backend(text, uuid) from public;
grant execute on function gateway.activate_task_contract_for_backend(text, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- 2. An active require_approval policy may be archived (status only).
-- ---------------------------------------------------------------------------
create or replace function authz.enforce_policy_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('authority.allow_demo_purge', true) = 'on' and current_user = 'postgres' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if old.status = 'active' then
    if tg_op = 'UPDATE'
       and old.effect = 'require_approval'
       and new.status = 'archived'
       and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
      return new;
    end if;
    raise exception 'an active policy version is immutable; create a new version instead'
      using errcode = '23514';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Approval rule management.
-- ---------------------------------------------------------------------------
create or replace function public.create_approval_rule(
  p_tenant_id uuid, p_name text, p_conditions jsonb, p_role public.tenant_role
)
returns table (car_status text, car_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item jsonb;
  v_name text := btrim(coalesce(p_name, ''));
  v_version integer;
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'create_approval_rule() requires an authenticated caller' using errcode = '28000';
  end if;
  if p_tenant_id is null or not authz.has_min_role(p_tenant_id, 'security_admin') then
    return query select 'forbidden'::text, null::uuid; return;
  end if;

  if char_length(v_name) not between 1 and 200 then
    return query select 'invalid_name'::text, null::uuid; return;
  end if;
  if p_role is null or p_role = 'viewer' then
    return query select 'invalid_role'::text, null::uuid; return;
  end if;
  -- 1-4 conditions, each {key, matches}, keys from the closed vocabulary
  -- approval-rules.ts evaluates, patterns printable ASCII up to 200 chars.
  if p_conditions is null or jsonb_typeof(p_conditions) <> 'array'
     or jsonb_array_length(p_conditions) not between 1 and 4 then
    return query select 'invalid_conditions'::text, null::uuid; return;
  end if;
  for v_item in select * from jsonb_array_elements(p_conditions) loop
    if jsonb_typeof(v_item) <> 'object'
       or (select count(*) from jsonb_object_keys(v_item)) <> 2
       or coalesce(v_item ->> 'key', '') not in ('tool', 'provider', 'resource', 'action')
       or coalesce(v_item ->> 'matches', '') !~ '^[\x20-\x7e]{1,200}$' then
      return query select 'invalid_conditions'::text, null::uuid; return;
    end if;
  end loop;

  select coalesce(max(version), 0) + 1 into v_version
  from public.policies where tenant_id = p_tenant_id and name = v_name;

  insert into public.policies (
    tenant_id, name, version, status, effect, conditions,
    required_approval_role, required_approval_count, created_by, activated_at
  ) values (
    p_tenant_id, v_name, v_version, 'active', 'require_approval',
    jsonb_build_object('schemaVersion', 1, 'rules', p_conditions),
    p_role, 1, (select auth.uid()), now()
  ) returning id into v_id;

  return query select 'ok'::text, v_id;
end;
$fn$;
revoke all on function public.create_approval_rule(uuid, text, jsonb, public.tenant_role) from public, anon;
grant execute on function public.create_approval_rule(uuid, text, jsonb, public.tenant_role) to authenticated;

create or replace function public.archive_approval_rule(p_policy_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant uuid; v_effect public.policy_effect; v_status public.policy_status;
begin
  if (select auth.uid()) is null then
    raise exception 'archive_approval_rule() requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id, effect, status into v_tenant, v_effect, v_status
  from public.policies where id = p_policy_id;
  if v_tenant is null or not authz.is_member_of(v_tenant) then return 'not_found'; end if;
  if not authz.has_min_role(v_tenant, 'security_admin') then return 'forbidden'; end if;
  if v_effect <> 'require_approval' then return 'not_found'; end if;
  if v_status <> 'active' then return 'ok'; end if;

  update public.policies set status = 'archived' where id = p_policy_id;
  return 'ok';
end;
$fn$;
revoke all on function public.archive_approval_rule(uuid) from public, anon;
grant execute on function public.archive_approval_rule(uuid) to authenticated;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261015000002'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
