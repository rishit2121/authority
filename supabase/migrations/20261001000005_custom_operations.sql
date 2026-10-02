-- Custom API operation registry: the trust boundary for tenant-published
-- operations (Phase 5 of the agent-integration roadmap).
--
-- Lifecycle: draft -> validated -> published -> retired. A draft is freely
-- editable by its tenant's developers. Validation is deterministic and
-- reversible (re-running it never requires a role beyond developer, since it
-- grants no trust by itself — it only checks). Publishing is the one
-- privileged, trust-conferring action: it requires an authorized
-- administrator (security_admin+, matching the bar this schema already sets
-- for policies — see policies_insert_by_security_admin_and_above) and is
-- irreversible. Once published, EVERY column is frozen by the trigger below.
--
-- Deliberately no in-place "new version of an existing operation": a slug is
-- unique per connection forever, published or not. Changing a published
-- operation's endpoint, mapping, or auth means publishing a DIFFERENT
-- operation (a new slug / new tool name) and retiring the old one — never
-- editing what a live contract or capability already points to. This is
-- what makes "operation ID" alone (no separate version number) sufficient
-- to pin: the ID's definition never changes after publish.
--
-- Retiring an operation only blocks it from NEW contract compilation
-- (plan-validator checks status = 'published' to admit a tool into a new
-- plan); it does not retroactively invalidate a contract already compiled
-- and active with it, and does not change the operation's own definition —
-- so an in-flight task can still run to completion.

create table public.custom_operation_definitions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  connection_id   uuid not null,
  -- Stable within one connection; the full tool name agents see is
  -- "<connection's connector_id>.<operation_slug>".
  operation_slug  text not null check (operation_slug ~ '^[a-z0-9_]{1,80}$'),
  tool_name       text not null check (tool_name ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  name            text not null check (char_length(btrim(name)) between 1 and 200),
  description     text check (description is null or char_length(description) <= 2000),
  method          text not null check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  -- "/v1/orders/{orderId}" — individual path segments only; the app layer
  -- rejects traversal and encoded separators before this is ever stored.
  path_template   text not null check (char_length(path_template) between 1 and 500 and path_template ~ '^/'),
  effect          text not null check (effect in ('read', 'write_create', 'write_update', 'write_delete', 'admin')),
  -- {"schemaVersion":1,"fields":[{"key":"orderId","type":"string","required":true,"identifiesResource":true,"in":"path"}]}
  input_schema    jsonb not null check (authz.has_allowed_schema_version(input_schema, array[1])),
  -- Constrained declarative mapping only — never a script. See docs/connectors/CUSTOM_API.md.
  request_mapping jsonb not null check (authz.has_allowed_schema_version(request_mapping, array[1])),
  auth_type       text not null default 'none' check (auth_type in ('none', 'bearer', 'api_key_header', 'basic')),
  -- Non-secret only (e.g. the header name for api_key_header). The secret
  -- value itself lives in connector_connection_secrets, never here.
  auth_config     jsonb not null default '{"schemaVersion":1}'::jsonb
    check (authz.has_allowed_schema_version(auth_config, array[1])),
  timeout_ms      integer not null default 8000 check (timeout_ms between 1000 and 30000),
  invocation_limit integer check (invocation_limit is null or invocation_limit between 1 and 100),
  status          text not null default 'draft' check (status in ('draft', 'validated', 'published', 'retired')),
  input_schema_hash text check (input_schema_hash is null or input_schema_hash ~ '^[0-9a-f]{64}$'),
  request_mapping_hash text check (request_mapping_hash is null or request_mapping_hash ~ '^[0-9a-f]{64}$'),
  created_by_principal_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  validated_at    timestamptz,
  validated_by_principal_id uuid,
  published_at    timestamptz,
  published_by_principal_id uuid,
  retired_at      timestamptz,
  retired_by_principal_id uuid,
  demo_key        text,
  unique (id, tenant_id),
  unique (connection_id, operation_slug),
  unique (tenant_id, tool_name),
  foreign key (connection_id, tenant_id) references public.connector_connections (id, tenant_id),
  foreign key (created_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  foreign key (validated_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  foreign key (published_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  foreign key (retired_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  constraint custom_op_validated_has_timestamp check (status not in ('validated', 'published', 'retired') or validated_at is not null),
  constraint custom_op_published_has_hashes
    check (status not in ('published', 'retired') or (input_schema_hash is not null and request_mapping_hash is not null and published_at is not null)),
  constraint custom_op_retired_has_timestamp check (status <> 'retired' or retired_at is not null)
);
create index custom_operation_definitions_tenant_idx on public.custom_operation_definitions (tenant_id, created_at desc);
create index custom_operation_definitions_connection_idx on public.custom_operation_definitions (connection_id);

create trigger custom_operation_definitions_touch_updated_at
  before update on public.custom_operation_definitions
  for each row execute function authz.touch_updated_at();

-- Once published, nothing about the operation's identity or behavior may
-- change — only the one-way published -> retired transition is permitted.
create or replace function gateway.enforce_custom_operation_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('published', 'retired') then
    if (new.tenant_id, new.connection_id, new.operation_slug, new.tool_name, new.name, new.description, new.method,
        new.path_template, new.effect, new.input_schema, new.request_mapping, new.auth_type, new.auth_config,
        new.timeout_ms, new.invocation_limit, new.input_schema_hash, new.request_mapping_hash)
       is distinct from
       (old.tenant_id, old.connection_id, old.operation_slug, old.tool_name, old.name, old.description, old.method,
        old.path_template, old.effect, old.input_schema, old.request_mapping, old.auth_type, old.auth_config,
        old.timeout_ms, old.invocation_limit, old.input_schema_hash, old.request_mapping_hash) then
      raise exception 'a % custom operation definition is immutable', old.status using errcode = '23514';
    end if;
    if old.status = 'retired' and new.status <> 'retired' then
      raise exception 'a retired custom operation cannot be un-retired' using errcode = '23514';
    end if;
    if old.status = 'published' and new.status not in ('published', 'retired') then
      raise exception 'a published custom operation can only move to retired' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function gateway.enforce_custom_operation_immutability() from public;
create trigger custom_operation_definitions_guard
  before update on public.custom_operation_definitions
  for each row execute function gateway.enforce_custom_operation_immutability();

alter table public.custom_operation_definitions enable row level security;
revoke all on public.custom_operation_definitions from public, anon, authenticated;
grant select on public.custom_operation_definitions to authenticated;
create policy "custom_operation_definitions_select_within_tenant" on public.custom_operation_definitions
  for select to authenticated using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- Lifecycle RPCs. Draft create/edit by developer+; validate by developer+
-- (grants no trust, only checks); publish/retire by security_admin+ only —
-- this is the one privileged, trust-conferring action in this whole table.
-- ---------------------------------------------------------------------------

create or replace function gateway.create_custom_operation_draft(
  p_tenant_id uuid, p_user_id uuid, p_connection_id uuid, p_operation_slug text, p_name text, p_description text,
  p_method text, p_path_template text, p_effect text, p_input_schema jsonb, p_request_mapping jsonb,
  p_auth_type text, p_auth_config jsonb, p_timeout_ms integer, p_invocation_limit integer
)
returns table (ccod_status text, ccod_operation_id uuid)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_connector_id text;
  v_tool_name text;
  v_id uuid;
  v_principal uuid;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'developer') then
    return query select 'forbidden'::text, null::uuid; return;
  end if;
  select connector_id into v_connector_id from public.connector_connections
    where id = p_connection_id and tenant_id = p_tenant_id and status <> 'disconnected';
  if v_connector_id is null then
    return query select 'connection_not_found'::text, null::uuid; return;
  end if;
  if p_operation_slug is null or p_operation_slug !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'operation slug must be lowercase alphanumeric/underscore, 1-80 chars' using errcode = '22023';
  end if;
  v_tool_name := v_connector_id || '.' || p_operation_slug;
  v_principal := gateway.actor_principal(p_tenant_id, p_user_id);
  insert into public.custom_operation_definitions (
    tenant_id, connection_id, operation_slug, tool_name, name, description, method, path_template, effect,
    input_schema, request_mapping, auth_type, auth_config, timeout_ms, invocation_limit, created_by_principal_id
  ) values (
    p_tenant_id, p_connection_id, p_operation_slug, v_tool_name, p_name, p_description, p_method, p_path_template, p_effect,
    coalesce(p_input_schema, '{"schemaVersion":1,"fields":[]}'::jsonb),
    coalesce(p_request_mapping, '{"schemaVersion":1}'::jsonb),
    coalesce(p_auth_type, 'none'), coalesce(p_auth_config, '{"schemaVersion":1}'::jsonb),
    coalesce(p_timeout_ms, 8000), p_invocation_limit, v_principal
  ) returning id into v_id;
  return query select 'ok'::text, v_id;
exception
  when unique_violation then
    return query select 'slug_taken'::text, null::uuid;
end;
$fn$;
revoke all on function gateway.create_custom_operation_draft(uuid, uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, text, jsonb, integer, integer) from public;
grant execute on function gateway.create_custom_operation_draft(uuid, uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, text, jsonb, integer, integer) to authority_gateway;

-- Deterministic structural validation only — no network call, no code
-- execution. Real semantic checks (SSRF/host allowlist, schema/mapping
-- well-formedness) live in the TypeScript layer (lib/connectors/custom-api/
-- validate.ts) and are re-run here as a second, independent check before the
-- status can advance — the database is not required to trust the app server
-- did this correctly.
create or replace function gateway.validate_custom_operation(p_tenant_id uuid, p_user_id uuid, p_operation_id uuid)
returns table (vco_status text, vco_input_schema_hash text, vco_request_mapping_hash text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  r public.custom_operation_definitions%rowtype;
  v_in_hash text;
  v_map_hash text;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'developer') then
    return query select 'forbidden'::text, null::text, null::text; return;
  end if;
  select * into r from public.custom_operation_definitions where id = p_operation_id and tenant_id = p_tenant_id;
  if r.id is null then return query select 'not_found'::text, null::text, null::text; return; end if;
  if r.status <> 'draft' then return query select 'not_draft'::text, null::text, null::text; return; end if;

  -- Structural checks a correct app-layer validator should already have
  -- enforced before calling this; re-checked here independently.
  if r.path_template !~ '\{[a-zA-Z0-9_]+\}' and jsonb_array_length(coalesce(r.input_schema -> 'fields', '[]'::jsonb)) = 0 then
    return query select 'invalid'::text, null::text, null::text; return;
  end if;
  if r.path_template like '%..%' or r.path_template like '%//%' then
    return query select 'invalid'::text, null::text, null::text; return;
  end if;

  v_in_hash := encode(extensions.digest(r.input_schema::text, 'sha256'), 'hex');
  v_map_hash := encode(extensions.digest(r.request_mapping::text, 'sha256'), 'hex');
  update public.custom_operation_definitions
    set status = 'validated', validated_at = now(), validated_by_principal_id = gateway.actor_principal(p_tenant_id, p_user_id),
        input_schema_hash = v_in_hash, request_mapping_hash = v_map_hash
    where id = p_operation_id;
  return query select 'ok'::text, v_in_hash, v_map_hash;
end;
$fn$;
revoke all on function gateway.validate_custom_operation(uuid, uuid, uuid) from public;
grant execute on function gateway.validate_custom_operation(uuid, uuid, uuid) to authority_gateway;

-- The one privileged, trust-conferring step.
create or replace function gateway.publish_custom_operation(p_tenant_id uuid, p_user_id uuid, p_operation_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'security_admin') then return 'forbidden'; end if;
  select status into v_status from public.custom_operation_definitions where id = p_operation_id and tenant_id = p_tenant_id;
  if v_status is null then return 'not_found'; end if;
  if v_status <> 'validated' then return 'not_validated'; end if;
  update public.custom_operation_definitions
    set status = 'published', published_at = now(), published_by_principal_id = gateway.actor_principal(p_tenant_id, p_user_id)
    where id = p_operation_id;
  return 'ok';
end;
$fn$;
revoke all on function gateway.publish_custom_operation(uuid, uuid, uuid) from public;
grant execute on function gateway.publish_custom_operation(uuid, uuid, uuid) to authority_gateway;

create or replace function gateway.retire_custom_operation(p_tenant_id uuid, p_user_id uuid, p_operation_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'security_admin') then return 'forbidden'; end if;
  select status into v_status from public.custom_operation_definitions where id = p_operation_id and tenant_id = p_tenant_id;
  if v_status is null then return 'not_found'; end if;
  if v_status <> 'published' then return 'not_published'; end if;
  update public.custom_operation_definitions
    set status = 'retired', retired_at = now(), retired_by_principal_id = gateway.actor_principal(p_tenant_id, p_user_id)
    where id = p_operation_id;
  return 'ok';
end;
$fn$;
revoke all on function gateway.retire_custom_operation(uuid, uuid, uuid) from public;
grant execute on function gateway.retire_custom_operation(uuid, uuid, uuid) to authority_gateway;

create or replace function gateway.update_custom_operation_draft(
  p_tenant_id uuid, p_user_id uuid, p_operation_id uuid, p_name text, p_description text, p_method text,
  p_path_template text, p_effect text, p_input_schema jsonb, p_request_mapping jsonb, p_auth_type text,
  p_auth_config jsonb, p_timeout_ms integer, p_invocation_limit integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'developer') then return 'forbidden'; end if;
  select status into v_status from public.custom_operation_definitions where id = p_operation_id and tenant_id = p_tenant_id;
  if v_status is null then return 'not_found'; end if;
  if v_status <> 'draft' then return 'not_draft'; end if;
  update public.custom_operation_definitions
    set name = coalesce(p_name, name), description = p_description, method = coalesce(p_method, method),
        path_template = coalesce(p_path_template, path_template), effect = coalesce(p_effect, effect),
        input_schema = coalesce(p_input_schema, input_schema), request_mapping = coalesce(p_request_mapping, request_mapping),
        auth_type = coalesce(p_auth_type, auth_type), auth_config = coalesce(p_auth_config, auth_config),
        timeout_ms = coalesce(p_timeout_ms, timeout_ms), invocation_limit = p_invocation_limit
    where id = p_operation_id;
  return 'ok';
end;
$fn$;
revoke all on function gateway.update_custom_operation_draft(uuid, uuid, uuid, text, text, text, text, text, jsonb, jsonb, text, jsonb, integer, integer) from public;
grant execute on function gateway.update_custom_operation_draft(uuid, uuid, uuid, text, text, text, text, text, jsonb, jsonb, text, jsonb, integer, integer) to authority_gateway;

create or replace function gateway.delete_custom_operation_draft(p_tenant_id uuid, p_user_id uuid, p_operation_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'developer') then return 'forbidden'; end if;
  select status into v_status from public.custom_operation_definitions where id = p_operation_id and tenant_id = p_tenant_id;
  if v_status is null then return 'not_found'; end if;
  if v_status <> 'draft' then return 'not_draft'; end if;
  delete from public.custom_operation_definitions where id = p_operation_id and tenant_id = p_tenant_id;
  return 'ok';
end;
$fn$;
revoke all on function gateway.delete_custom_operation_draft(uuid, uuid, uuid) from public;
grant execute on function gateway.delete_custom_operation_draft(uuid, uuid, uuid) to authority_gateway;
