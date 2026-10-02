-- Fixes two bugs in 20261001000013's gateway.validate_postgres_query:
--
-- 1. The "must start with SELECT or WITH" check was applied
--    unconditionally, rejecting every legitimate write query (UPDATE/
--    INSERT/DELETE never start with SELECT or WITH). That check is only
--    meaningful for a declared READ -- confirming a nominal read statement
--    really is one -- never for a declared write.
--
-- 2. A declared-optional field was accepted even though a native
--    parameterized query has no way to "skip" a ":name" placeholder that is
--    present in the statement -- unlike Custom API, where an optional
--    query-string field can simply be left out of the URL. Every field must
--    now be required.
--
-- Both match the same fix applied to the TypeScript mirror,
-- src/lib/connectors/postgres/validate.ts.
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

  -- Only a declared read is required to start with SELECT/WITH -- a write
  -- legitimately starts with INSERT/UPDATE/DELETE/MERGE.
  v_normalized := lower(btrim(r.sql_template));
  if r.effect = 'read' and v_normalized !~ '^(select|with)\s' and v_normalized !~ '^(select|with)$' then
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
    if not (v_field ->> 'required')::boolean then
      return query select 'invalid'::text, null::text, null::text; return;
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

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261001000014'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
