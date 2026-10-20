-- Explicit, per-application opt-in for automatic execution of selected published Custom API write operations.
--
-- Every published Custom API write is registered with requiresApproval (src/lib/registry/tenant.ts), so each
-- call is held for a person by default. That default is unchanged. A security admin may now opt ONE
-- application in for ONE published operation at a time; for that application's tasks only, the
-- registry-level hold is not applied to that exact tool. Nothing else changes: contracts, argument
-- constraints, budgets, sessions, connection bindings and task alignment still apply, and explicit approval
-- rules (runtime approval classes) and alignment holds still hold the call. Every change is recorded in an
-- append-only audit table.

create table public.application_custom_operation_auto_execute (
  application_id         uuid not null references public.applications (id) on delete cascade,
  operation_definition_id uuid not null,
  tenant_id              uuid not null references public.tenants (id) on delete cascade,
  tool_name              text not null check (tool_name ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  enabled_by             uuid not null,
  enabled_at             timestamptz not null default now(),
  note                   text check (note is null or char_length(note) <= 500),
  primary key (application_id, operation_definition_id),
  foreign key (operation_definition_id, tenant_id) references public.custom_operation_definitions (id, tenant_id) on delete cascade
);
create index application_custom_op_auto_execute_tenant_idx on public.application_custom_operation_auto_execute (tenant_id);

create table public.custom_operation_auto_execute_audit (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants (id) on delete cascade,
  application_id         uuid not null,
  operation_definition_id uuid not null,
  tool_name              text not null,
  action                 text not null check (action in ('enabled', 'disabled')),
  actor_user_id          uuid not null,
  note                   text check (note is null or char_length(note) <= 500),
  created_at             timestamptz not null default now()
);
create index custom_op_auto_execute_audit_app_idx on public.custom_operation_auto_execute_audit (application_id, created_at desc);
create trigger custom_operation_auto_execute_audit_append_only
  before update or delete on public.custom_operation_auto_execute_audit
  for each row execute function authz.forbid_update_delete();

alter table public.application_custom_operation_auto_execute enable row level security;
alter table public.custom_operation_auto_execute_audit enable row level security;
revoke all on public.application_custom_operation_auto_execute, public.custom_operation_auto_execute_audit
  from public, anon, authenticated;
grant select on public.application_custom_operation_auto_execute, public.custom_operation_auto_execute_audit
  to authenticated;
create policy application_custom_op_auto_execute_select on public.application_custom_operation_auto_execute
  for select to authenticated using (authz.is_member_of(tenant_id));
create policy custom_op_auto_execute_audit_select on public.custom_operation_auto_execute_audit
  for select to authenticated using (authz.is_member_of(tenant_id));

-- Dashboard (security admin and above). Only a published, non-read operation of the same tenant qualifies.
create or replace function public.set_custom_operation_auto_execute(
  p_application_id uuid, p_operation_definition_id uuid, p_enabled boolean, p_note text
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant uuid;
  v_tool text;
  v_effect text;
  v_status text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if (select auth.uid()) is null then
    raise exception 'set_custom_operation_auto_execute() requires an authenticated caller' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.applications where id = p_application_id;
  if v_tenant is null or not authz.is_member_of(v_tenant) then return 'not_found'; end if;
  if not authz.has_min_role(v_tenant, 'security_admin') then return 'forbidden'; end if;
  if p_enabled is null or (v_note is not null and char_length(v_note) > 500) then return 'invalid_request'; end if;

  select tool_name, effect, status into v_tool, v_effect, v_status
  from public.custom_operation_definitions where id = p_operation_definition_id and tenant_id = v_tenant;
  if v_tool is null then return 'not_found'; end if;

  if p_enabled then
    if v_status <> 'published' or v_effect = 'read' then return 'invalid_request'; end if;
    insert into public.application_custom_operation_auto_execute
      (application_id, operation_definition_id, tenant_id, tool_name, enabled_by, note)
    values (p_application_id, p_operation_definition_id, v_tenant, v_tool, (select auth.uid()), v_note)
    on conflict (application_id, operation_definition_id) do nothing;
    if not found then return 'ok'; end if;
  else
    delete from public.application_custom_operation_auto_execute
    where application_id = p_application_id and operation_definition_id = p_operation_definition_id;
    if not found then return 'ok'; end if;
  end if;

  insert into public.custom_operation_auto_execute_audit
    (tenant_id, application_id, operation_definition_id, tool_name, action, actor_user_id, note)
  values (v_tenant, p_application_id, p_operation_definition_id, v_tool,
          case when p_enabled then 'enabled' else 'disabled' end, (select auth.uid()), v_note);
  return 'ok';
end;
$fn$;
revoke all on function public.set_custom_operation_auto_execute(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.set_custom_operation_auto_execute(uuid, uuid, boolean, text) to authenticated;

-- Gateway (authorize route and tool manifest): the opted-in tools for this task's application, side-effect
-- free like gateway.tenant_for_task. A task with no customer (no application) gets none. Only operations
-- still published count, so retiring an operation ends its automatic execution.
create or replace function gateway.auto_execute_tools_for_task(p_task_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(a.tool_name order by a.tool_name), '{}'::text[])
  from public.tasks t
  join public.customers c on c.id = t.customer_id and c.tenant_id = t.tenant_id
  join public.application_custom_operation_auto_execute a
    on a.application_id = c.application_id and a.tenant_id = t.tenant_id
  join public.custom_operation_definitions d
    on d.id = a.operation_definition_id and d.tenant_id = a.tenant_id and d.status = 'published'
  where t.id = p_task_id;
$$;
revoke all on function gateway.auto_execute_tools_for_task(uuid) from public;
grant execute on function gateway.auto_execute_tools_for_task(uuid) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261020000001'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
