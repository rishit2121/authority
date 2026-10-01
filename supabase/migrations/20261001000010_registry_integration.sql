-- Phase: merging a tenant's published custom operations into the
-- deterministic plan-validator/solver/compiler/verifier pipeline's registry
-- (previously GitHub-fixture-only). Two independent pieces:
--
-- 1. A side-effect-free read the app server uses to assemble a per-tenant
--    `LoadedRegistry` (src/lib/registry/tenant.ts) -- `authority_gateway` has
--    no direct table privileges, so even this read needs a SECURITY DEFINER
--    function, same as every other gateway.* read. Mirrors
--    gateway.get_published_custom_operation's own trust boundary (published
--    + active connection only), but lists every such operation for a
--    tenant rather than resolving one by connection+slug.
--
-- 2. Strengthening gateway.validate_custom_operation with the same
--    structural checks src/lib/connectors/custom-api/validate.ts enforces at
--    authoring time (exactly one identifiesResource field, every path
--    placeholder matched symmetrically against a path-located field) --
--    that TypeScript module's own comment already promised this would
--    happen; this migration delivers it. The database must not trust the
--    app layer did this correctly before marking a draft "validated".

-- Side-effect-free tenant resolution from a task id, same pattern and the
-- same justification as gateway.jev_risk_mode_for_task (20260930000019):
-- a plain read, none of resolve_credential's rate-limiting/auth-event/
-- last-used-at side effects, safe to call once per request in addition to
-- (not instead of) the credential resolution prepare_authorization/
-- commit_authorization already do internally. Named independently of Jev
-- since the authorize route needs this purely to build a tenant-scoped
-- registry (src/lib/registry/tenant.ts) before computing this request's
-- registryVersion -- unrelated to Jev's risk mode.
create or replace function gateway.tenant_for_task(p_task_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tenant_id from public.tasks where id = p_task_id;
$$;
revoke all on function gateway.tenant_for_task(uuid) from public;
grant execute on function gateway.tenant_for_task(uuid) to authority_gateway;

create or replace function gateway.list_published_custom_operations_for_tenant(p_tenant_id uuid)
returns table (
  lpco_operation_id uuid,
  lpco_tool_name text,
  lpco_operation_slug text,
  lpco_name text,
  lpco_description text,
  lpco_effect text,
  lpco_input_schema jsonb,
  lpco_input_schema_hash text,
  lpco_request_mapping_hash text,
  lpco_connector_id text,
  lpco_published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select cod.id, cod.tool_name, cod.operation_slug, cod.name, cod.description, cod.effect,
         cod.input_schema, cod.input_schema_hash, cod.request_mapping_hash, cc.connector_id, cod.published_at
  from public.custom_operation_definitions cod
  join public.connector_connections cc on cc.id = cod.connection_id
  where cod.tenant_id = p_tenant_id
    and cod.status = 'published'
    and cc.status = 'active'
  order by cod.tool_name;
$$;
revoke all on function gateway.list_published_custom_operations_for_tenant(uuid) from public;
grant execute on function gateway.list_published_custom_operations_for_tenant(uuid) to authority_gateway;

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
  v_fields jsonb;
  v_field jsonb;
  v_identifies_count integer := 0;
  v_path_keys text[] := '{}';
  v_placeholders text[];
  v_key text;
begin
  if not gateway.actor_meets_role(p_tenant_id, p_user_id, 'developer') then
    return query select 'forbidden'::text, null::text, null::text; return;
  end if;
  select * into r from public.custom_operation_definitions where id = p_operation_id and tenant_id = p_tenant_id;
  if r.id is null then return query select 'not_found'::text, null::text, null::text; return; end if;
  if r.status <> 'draft' then return query select 'not_draft'::text, null::text, null::text; return; end if;

  if r.path_template !~ '\{[a-zA-Z0-9_]+\}' and jsonb_array_length(coalesce(r.input_schema -> 'fields', '[]'::jsonb)) = 0 then
    return query select 'invalid'::text, null::text, null::text; return;
  end if;
  if r.path_template like '%..%' or r.path_template like '%//%' then
    return query select 'invalid'::text, null::text, null::text; return;
  end if;

  -- Independently re-derive what src/lib/connectors/custom-api/validate.ts
  -- already checked at authoring time: exactly one identifiesResource
  -- field, and path placeholders matched symmetrically against
  -- path-located fields. A definition that fails here was either tampered
  -- with between authoring and this call, or reached this RPC by some path
  -- other than the reviewed server action.
  v_fields := coalesce(r.input_schema -> 'fields', '[]'::jsonb);
  for v_field in select * from jsonb_array_elements(v_fields)
  loop
    if (v_field ->> 'identifiesResource')::boolean then
      v_identifies_count := v_identifies_count + 1;
    end if;
    if v_field ->> 'in' = 'path' then
      v_path_keys := array_append(v_path_keys, v_field ->> 'key');
    end if;
  end loop;
  if v_identifies_count <> 1 then
    return query select 'invalid'::text, null::text, null::text; return;
  end if;

  select array_agg(m[1]) into v_placeholders
  from regexp_matches(r.path_template, '\{([a-zA-Z0-9_]+)\}', 'g') as m;
  v_placeholders := coalesce(v_placeholders, '{}');

  foreach v_key in array v_placeholders loop
    if not (v_key = any(v_path_keys)) then
      return query select 'invalid'::text, null::text, null::text; return;
    end if;
  end loop;
  foreach v_key in array v_path_keys loop
    if not (v_key = any(v_placeholders)) then
      return query select 'invalid'::text, null::text, null::text; return;
    end if;
  end loop;

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

create or replace function gateway.schema_version()
returns text
language sql
immutable
set search_path = ''
as $$ select '20261001000010'::text $$;
revoke all on function gateway.schema_version() from public;
grant execute on function gateway.schema_version() to authority_gateway;
