-- PostgreSQL connector: tenant-defined named queries (Phase 9 of the
-- agent-integration roadmap). Every tenant's own database schema is
-- different -- there is no fixed, universal "retrieve a row" operation the
-- way Stripe has "retrieve a payment" -- so, like Custom API, the trust
-- boundary is a tenant-authored, admin-published definition rather than
-- static registry code. This table and its lifecycle RPCs are a direct
-- structural mirror of custom_operation_definitions
-- (20261001000005_custom_operations.sql): draft -> validated -> published
-- -> retired, immutable once published, a slug unique per connection
-- forever. See that migration's own comment for the reasoning behind each
-- of those rules; it is not repeated here.
--
-- What's different from an HTTP operation:
--  - No method/path_template/auth_type/auth_config: a query runs against the
--    one already-authenticated connection, not a per-operation destination.
--  - `sql_template` holds named parameter placeholders (":customer_id", not
--    "{customer_id}") -- converted to a native parameterized query
--    ($1, $2, ...) at execution time (src/lib/connectors/postgres/
--    request-builder.ts), never string-interpolated.
--  - `effect = 'read'` is independently re-verified here to actually be a
--    read: Postgres allows data-modifying statements inside a WITH-CTE
--    headed by a nominal SELECT ("WITH x AS (DELETE ... RETURNING *) SELECT
--    * FROM x"), so a first-token check alone is not enough -- see
--    `gateway.validate_postgres_query`'s own comment.
--  - Like Custom API's connector_id, this connector's provider id is
--    per-connection ("postgres_<hex>"), not a fixed constant: a tenant may
--    reasonably want more than one simultaneously active Postgres
--    connection (e.g. a primary and a read replica), unlike Stripe/Slack/
--    Gmail's one-account-at-a-time model.

create table public.postgres_query_definitions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  connection_id   uuid not null,
  query_slug      text not null check (query_slug ~ '^[a-z0-9_]{1,80}$'),
  tool_name       text not null check (tool_name ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),
  name            text not null check (char_length(btrim(name)) between 1 and 200),
  description     text check (description is null or char_length(description) <= 2000),
  sql_template    text not null check (char_length(sql_template) between 1 and 8000),
  effect          text not null check (effect in ('read', 'write_create', 'write_update', 'write_delete', 'admin')),
  -- {"schemaVersion":1,"fields":[{"key":"customerId","type":"string","required":true,"identifiesResource":true}]}
  input_schema    jsonb not null check (authz.has_allowed_schema_version(input_schema, array[1])),
  -- A query's own statement timeout -- distinct from, and always bounded
  -- tighter than, any server-side default, since an admin-authored query
  -- against an unfamiliar tenant schema is exactly the kind of thing that
  -- can accidentally run away.
  timeout_ms      integer not null default 5000 check (timeout_ms between 1000 and 30000),
  invocation_limit integer check (invocation_limit is null or invocation_limit between 1 and 100),
  status          text not null default 'draft' check (status in ('draft', 'validated', 'published', 'retired')),
  input_schema_hash text check (input_schema_hash is null or input_schema_hash ~ '^[0-9a-f]{64}$'),
  sql_template_hash text check (sql_template_hash is null or sql_template_hash ~ '^[0-9a-f]{64}$'),
  created_by_principal_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  validated_at    timestamptz,
  validated_by_principal_id uuid,
  published_at    timestamptz,
  published_by_principal_id uuid,
  retired_at      timestamptz,
  retired_by_principal_id uuid,
  unique (id, tenant_id),
  unique (connection_id, query_slug),
  unique (tenant_id, tool_name),
  foreign key (connection_id, tenant_id) references public.connector_connections (id, tenant_id),
  foreign key (created_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  foreign key (validated_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  foreign key (published_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  foreign key (retired_by_principal_id, tenant_id) references public.principals (id, tenant_id),
  constraint postgres_query_validated_has_timestamp check (status not in ('validated', 'published', 'retired') or validated_at is not null),
  constraint postgres_query_published_has_hashes
    check (status not in ('published', 'retired') or (input_schema_hash is not null and sql_template_hash is not null and published_at is not null)),
  constraint postgres_query_retired_has_timestamp check (status <> 'retired' or retired_at is not null)
);
create index postgres_query_definitions_tenant_idx on public.postgres_query_definitions (tenant_id, created_at desc);
create index postgres_query_definitions_connection_idx on public.postgres_query_definitions (connection_id);

create trigger postgres_query_definitions_touch_updated_at
  before update on public.postgres_query_definitions
  for each row execute function authz.touch_updated_at();

create or replace function gateway.enforce_postgres_query_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('published', 'retired') then
    if (new.tenant_id, new.connection_id, new.query_slug, new.tool_name, new.name, new.description,
        new.sql_template, new.effect, new.input_schema, new.timeout_ms, new.invocation_limit,
        new.input_schema_hash, new.sql_template_hash)
       is distinct from
       (old.tenant_id, old.connection_id, old.query_slug, old.tool_name, old.name, old.description,
        old.sql_template, old.effect, old.input_schema, old.timeout_ms, old.invocation_limit,
        old.input_schema_hash, old.sql_template_hash) then
      raise exception 'a % postgres query definition is immutable', old.status using errcode = '23514';
    end if;
    if old.status = 'retired' and new.status <> 'retired' then
      raise exception 'a retired postgres query cannot be un-retired' using errcode = '23514';
    end if;
    if old.status = 'published' and new.status not in ('published', 'retired') then
      raise exception 'a published postgres query can only move to retired' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function gateway.enforce_postgres_query_immutability() from public;
create trigger postgres_query_definitions_guard
  before update on public.postgres_query_definitions
  for each row execute function gateway.enforce_postgres_query_immutability();

alter table public.postgres_query_definitions enable row level security;
revoke all on public.postgres_query_definitions from public, anon, authenticated;
grant select on public.postgres_query_definitions to authenticated;
create policy "postgres_query_definitions_select_within_tenant" on public.postgres_query_definitions
  for select to authenticated using (authz.is_member_of(tenant_id));

-- ---------------------------------------------------------------------------
-- Lifecycle RPCs -- same role boundaries as custom_operation_definitions'
-- own: draft create/edit/delete by developer+, validate by developer+
-- (grants no trust), publish/retire by security_admin+ only.
-- ---------------------------------------------------------------------------

create or replace function gateway.create_postgres_query_draft(
  p_tenant_id uuid, p_user_id uuid, p_connection_id uuid, p_query_slug text, p_name text, p_description text,
  p_sql_template text, p_effect text, p_input_schema jsonb, p_timeout_ms integer, p_invocation_limit integer
)
returns table (cpqd_status text, cpqd_query_id uuid)
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
  if p_query_slug is null or p_query_slug !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'query slug must be lowercase alphanumeric/underscore, 1-80 chars' using errcode = '22023';
  end if;
  v_tool_name := v_connector_id || '.' || p_query_slug;
  v_principal := gateway.actor_principal(p_tenant_id, p_user_id);
  insert into public.postgres_query_definitions (
    tenant_id, connection_id, query_slug, tool_name, name, description, sql_template, effect,
    input_schema, timeout_ms, invocation_limit, created_by_principal_id
  ) values (
    p_tenant_id, p_connection_id, p_query_slug, v_tool_name, p_name, p_description, p_sql_template, p_effect,
    coalesce(p_input_schema, '{"schemaVersion":1,"fields":[]}'::jsonb),
    coalesce(p_timeout_ms, 5000), p_invocation_limit, v_principal
  ) returning id into v_id;
  return query select 'ok'::text, v_id;
exception
  when unique_violation then
    return query select 'slug_taken'::text, null::uuid;
end;
$fn$;
revoke all on function gateway.create_postgres_query_draft(uuid, uuid, uuid, text, text, text, text, text, jsonb, integer, integer) from public;
grant execute on function gateway.create_postgres_query_draft(uuid, uuid, uuid, text, text, text, text, text, jsonb, integer, integer) to authority_gateway;

-- Deterministic structural validation only -- no query is ever executed
-- here. Real checks (symmetric placeholder/field matching, the read-effect
-- keyword scan) live in the TypeScript layer
-- (lib/connectors/postgres/validate.ts) and are re-run here independently,
-- same two-layer relationship custom_operation_definitions has to its own
-- TypeScript validator.
create or replace function gateway.validate_postgres_query(p_tenant_id uuid, p_user_id uuid, p_query_id uuid)
returns table (vpq_status text, vpq_input_schema_hash text, vpq_sql_template_hash text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  r public.postgres_query_definitions%rowtype;
  v_in_hash text;
  v_sql_hash text;
  v_fields jsonb;
  v_field jsonb;
  v_identifies_count integer := 0;
  v_placeholders text[];
  v_field_keys text[] := '{}';
  v_key text;
  v_normalized text;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'developer') then
    return query select 'forbidden'::text, null::text, null::text; return;
  end if;
  select * into r from public.postgres_query_definitions where id = p_query_id and tenant_id = p_tenant_id;
  if r.id is null then return query select 'not_found'::text, null::text, null::text; return; end if;
  if r.status <> 'draft' then return query select 'not_draft'::text, null::text, null::text; return; end if;

  -- Exactly one statement: a bare semicolon anywhere but a single optional
  -- trailing one means statement stacking, never a legitimate single query.
  if btrim(r.sql_template, ' ;' || chr(9) || chr(10) || chr(13)) ~ ';' then
    return query select 'invalid'::text, null::text, null::text; return;
  end if;

  v_normalized := lower(btrim(r.sql_template));
  if v_normalized !~ '^(select|with)\s' and v_normalized !~ '^(select|with)$' then
    return query select 'invalid'::text, null::text, null::text; return;
  end if;

  -- A nominal SELECT can still write via a data-modifying CTE ("WITH x AS
  -- (DELETE FROM ... RETURNING *) SELECT * FROM x") -- a first-token check
  -- alone cannot catch this, so a declared read is independently re-scanned
  -- for any DML/DDL keyword anywhere in the statement, not just its head.
  if r.effect = 'read' and r.sql_template ~* '\y(insert|update|delete|merge|drop|alter|truncate|grant|revoke|create|copy|vacuum|execute|call|do|listen|notify|refresh|reindex|cluster|comment|security)\y' then
    return query select 'invalid'::text, null::text, null::text; return;
  end if;
  -- Even a declared write may never be a schema/permissions change --
  -- those belong to a real migration, not an agent-callable query.
  if r.sql_template ~* '\y(drop|alter|truncate|grant|revoke|create|vacuum|reindex|cluster)\y' then
    return query select 'invalid'::text, null::text, null::text; return;
  end if;

  v_fields := coalesce(r.input_schema -> 'fields', '[]'::jsonb);
  if jsonb_array_length(v_fields) = 0 then
    return query select 'invalid'::text, null::text, null::text; return;
  end if;
  for v_field in select * from jsonb_array_elements(v_fields)
  loop
    if (v_field ->> 'identifiesResource')::boolean then
      v_identifies_count := v_identifies_count + 1;
    end if;
    v_field_keys := array_append(v_field_keys, v_field ->> 'key');
  end loop;
  if v_identifies_count <> 1 then
    return query select 'invalid'::text, null::text, null::text; return;
  end if;

  -- Every ":name" placeholder needs a declared field, and vice versa -- the
  -- same symmetric check custom_operation_definitions runs for path
  -- placeholders. A leading "::" (Postgres's own cast operator, e.g.
  -- "price::numeric") is excluded by requiring the character immediately
  -- before the colon not be a colon itself.
  select array_agg(distinct m[1]) into v_placeholders
  from regexp_matches(r.sql_template, '(?<!:):([a-zA-Z][a-zA-Z0-9_]*)', 'g') as m;
  v_placeholders := coalesce(v_placeholders, '{}');

  foreach v_key in array v_placeholders loop
    if not (v_key = any(v_field_keys)) then
      return query select 'invalid'::text, null::text, null::text; return;
    end if;
  end loop;
  foreach v_key in array v_field_keys loop
    if not (v_key = any(v_placeholders)) then
      return query select 'invalid'::text, null::text, null::text; return;
    end if;
  end loop;

  v_in_hash := encode(extensions.digest(r.input_schema::text, 'sha256'), 'hex');
  v_sql_hash := encode(extensions.digest(r.sql_template, 'sha256'), 'hex');
  update public.postgres_query_definitions
    set status = 'validated', validated_at = now(), validated_by_principal_id = gateway.actor_principal(p_tenant_id, p_user_id),
        input_schema_hash = v_in_hash, sql_template_hash = v_sql_hash
    where id = p_query_id;
  return query select 'ok'::text, v_in_hash, v_sql_hash;
end;
$fn$;
revoke all on function gateway.validate_postgres_query(uuid, uuid, uuid) from public;
grant execute on function gateway.validate_postgres_query(uuid, uuid, uuid) to authority_gateway;

create or replace function gateway.publish_postgres_query(p_tenant_id uuid, p_user_id uuid, p_query_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'security_admin') then return 'forbidden'; end if;
  select status into v_status from public.postgres_query_definitions where id = p_query_id and tenant_id = p_tenant_id;
  if v_status is null then return 'not_found'; end if;
  if v_status <> 'validated' then return 'not_validated'; end if;
  update public.postgres_query_definitions
    set status = 'published', published_at = now(), published_by_principal_id = gateway.actor_principal(p_tenant_id, p_user_id)
    where id = p_query_id;
  return 'ok';
end;
$fn$;
revoke all on function gateway.publish_postgres_query(uuid, uuid, uuid) from public;
grant execute on function gateway.publish_postgres_query(uuid, uuid, uuid) to authority_gateway;

create or replace function gateway.retire_postgres_query(p_tenant_id uuid, p_user_id uuid, p_query_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'security_admin') then return 'forbidden'; end if;
  select status into v_status from public.postgres_query_definitions where id = p_query_id and tenant_id = p_tenant_id;
  if v_status is null then return 'not_found'; end if;
  if v_status <> 'published' then return 'not_published'; end if;
  update public.postgres_query_definitions
    set status = 'retired', retired_at = now(), retired_by_principal_id = gateway.actor_principal(p_tenant_id, p_user_id)
    where id = p_query_id;
  return 'ok';
end;
$fn$;
revoke all on function gateway.retire_postgres_query(uuid, uuid, uuid) from public;
grant execute on function gateway.retire_postgres_query(uuid, uuid, uuid) to authority_gateway;

create or replace function gateway.update_postgres_query_draft(
  p_tenant_id uuid, p_user_id uuid, p_query_id uuid, p_name text, p_description text, p_sql_template text,
  p_effect text, p_input_schema jsonb, p_timeout_ms integer, p_invocation_limit integer
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
  select status into v_status from public.postgres_query_definitions where id = p_query_id and tenant_id = p_tenant_id;
  if v_status is null then return 'not_found'; end if;
  if v_status <> 'draft' then return 'not_draft'; end if;
  update public.postgres_query_definitions
    set name = coalesce(p_name, name), description = p_description, sql_template = coalesce(p_sql_template, sql_template),
        effect = coalesce(p_effect, effect), input_schema = coalesce(p_input_schema, input_schema),
        timeout_ms = coalesce(p_timeout_ms, timeout_ms), invocation_limit = p_invocation_limit
    where id = p_query_id;
  return 'ok';
end;
$fn$;
revoke all on function gateway.update_postgres_query_draft(uuid, uuid, uuid, text, text, text, text, jsonb, integer, integer) from public;
grant execute on function gateway.update_postgres_query_draft(uuid, uuid, uuid, text, text, text, text, jsonb, integer, integer) to authority_gateway;

create or replace function gateway.delete_postgres_query_draft(p_tenant_id uuid, p_user_id uuid, p_query_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'developer') then return 'forbidden'; end if;
  select status into v_status from public.postgres_query_definitions where id = p_query_id and tenant_id = p_tenant_id;
  if v_status is null then return 'not_found'; end if;
  if v_status <> 'draft' then return 'not_draft'; end if;
  delete from public.postgres_query_definitions where id = p_query_id and tenant_id = p_tenant_id;
  return 'ok';
end;
$fn$;
revoke all on function gateway.delete_postgres_query_draft(uuid, uuid, uuid) from public;
grant execute on function gateway.delete_postgres_query_draft(uuid, uuid, uuid) to authority_gateway;

-- ---------------------------------------------------------------------------
-- Reads used by connector execution and the tenant registry merge -- same
-- shape and trust boundary as gateway.get_published_custom_operation /
-- gateway.list_published_custom_operations_for_tenant
-- (20261001000009_resolve_published_custom_operation.sql,
-- 20261001000010_registry_integration.sql).
-- ---------------------------------------------------------------------------

create or replace function gateway.get_published_postgres_query(p_connection_id uuid, p_query_slug text)
returns table (
  gppq_query_id uuid,
  gppq_tool_name text,
  gppq_sql_template text,
  gppq_effect text,
  gppq_input_schema jsonb,
  gppq_timeout_ms integer,
  gppq_connection_status text,
  gppq_connection_config jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select pqd.id, pqd.tool_name, pqd.sql_template, pqd.effect, pqd.input_schema, pqd.timeout_ms,
         cc.status::text, cc.config
  from public.postgres_query_definitions pqd
  join public.connector_connections cc on cc.id = pqd.connection_id
  where pqd.connection_id = p_connection_id
    and pqd.query_slug = p_query_slug
    and pqd.status = 'published';
$$;
revoke all on function gateway.get_published_postgres_query(uuid, text) from public;
grant execute on function gateway.get_published_postgres_query(uuid, text) to authority_gateway;

create or replace function gateway.list_published_postgres_queries_for_tenant(p_tenant_id uuid)
returns table (
  lppq_query_id uuid,
  lppq_tool_name text,
  lppq_query_slug text,
  lppq_name text,
  lppq_description text,
  lppq_effect text,
  lppq_input_schema jsonb,
  lppq_input_schema_hash text,
  lppq_sql_template_hash text,
  lppq_connector_id text,
  lppq_connection_name text,
  lppq_published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select pqd.id, pqd.tool_name, pqd.query_slug, pqd.name, pqd.description, pqd.effect,
         pqd.input_schema, pqd.input_schema_hash, pqd.sql_template_hash, cc.connector_id, cc.name, pqd.published_at
  from public.postgres_query_definitions pqd
  join public.connector_connections cc on cc.id = pqd.connection_id
  where pqd.tenant_id = p_tenant_id
    and pqd.status = 'published'
    and cc.status = 'active'
  order by pqd.tool_name;
$$;
revoke all on function gateway.list_published_postgres_queries_for_tenant(uuid) from public;
grant execute on function gateway.list_published_postgres_queries_for_tenant(uuid) to authority_gateway;

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261001000013'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
