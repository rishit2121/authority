-- Part 8: the engine chooses the task id up front so the compiled contract can pin task-scoped values.

create or replace function gateway.vl_seed_sandbox(p_sandbox uuid, p_spec jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_principal uuid := gen_random_uuid();
  v_task uuid := coalesce((p_spec ->> 'taskId')::uuid, gen_random_uuid());
  v_contract uuid := gen_random_uuid();
  v_agents jsonb := '{}'::jsonb;
  v_agent uuid;
  a jsonb;
  c jsonb := p_spec -> 'contract';
  s jsonb := coalesce(p_spec -> 'settings', '{}'::jsonb);
  v_mode public.semantic_mode := coalesce(s ->> 'mode', 'off')::public.semantic_mode;
  v_provider text := coalesce(s ->> 'provider', 'mock');
  v_model text := coalesce(s ->> 'model', 'mock-heuristic');
  v_inst uuid;
  v_inst_gh bigint;
  r jsonb;
  v_repo uuid;
  v_bound uuid;
  v_repos jsonb := '{}'::jsonb;
  v_i integer := 0;
  v_primary text := coalesce(p_spec ->> 'primaryAgent', 'primary');
begin
  perform gateway.vl_assert_sandbox(p_sandbox);
  if c is null or jsonb_typeof(p_spec -> 'agents') <> 'array' or jsonb_array_length(p_spec -> 'agents') not between 1 and 5 then
    raise exception 'sandbox spec needs a contract and 1-5 agents' using errcode = '22023';
  end if;
  if pg_column_size(p_spec) > 65536 then raise exception 'sandbox spec too large' using errcode = '22023'; end if;

  insert into public.principals (id, tenant_id, kind, display_name) values (v_principal, p_sandbox, 'human', 'Validation task owner');

  for a in select e.value from jsonb_array_elements(p_spec -> 'agents') e loop
    v_agent := gen_random_uuid();
    insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status)
    values (v_agent, p_sandbox, 'vl-' || (a ->> 'key'), 'synthetic', 'synthetic', 'validation', v_principal, 'active');
    insert into public.agent_credentials (tenant_id, agent_id, key_prefix, key_hash, status)
    values (p_sandbox, v_agent, a ->> 'keyPrefix', a ->> 'keyHash', 'active');
    v_agents := v_agents || jsonb_build_object(a ->> 'key', v_agent);
  end loop;
  if not (v_agents ? v_primary) then raise exception 'primary agent missing' using errcode = '22023'; end if;

  insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status)
  values (v_task, p_sandbox, (v_agents ->> v_primary)::uuid, v_principal, left(coalesce(p_spec ->> 'intent', 'validation task'), 4000), 'contract_issued');

  insert into public.task_authority_contracts (
    id, tenant_id, task_id, version, spec_version, allowed_actions, forbidden_resources, forbidden_operations,
    ephemeral_limits, contract_status, registry_version, compiler_version, input_hash, output_hash,
    data_flow_bindings, required_approvals, activated_at, expires_at, required_approvals_spec, demo_key
  ) values (
    v_contract, p_sandbox, v_task, 1, coalesce(c ->> 'specVersion', 'v1'), c -> 'allowedActions',
    array(select jsonb_array_elements_text(coalesce(c -> 'forbiddenResources', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(c -> 'forbiddenOperations', '[]'::jsonb))),
    c -> 'ephemeralLimits', 'active', c ->> 'registryVersion', c ->> 'compilerVersion',
    coalesce(c ->> 'inputHash', repeat('9', 64)), coalesce(c ->> 'outputHash', repeat('8', 64)),
    jsonb_build_object('schemaVersion', 1, 'refs', coalesce(c -> 'dataFlowBindings', '[]'::jsonb)),
    '{"schemaVersion":1,"items":[]}'::jsonb, now(), now() + interval '2 hours', '{"schemaVersion":1,"items":[]}'::jsonb,
    'validation:' || v_contract::text
  );

  insert into public.semantic_settings (
    tenant_id, mode, provider, model, timeout_ms, semantic_required_classes, capability_ttl_seconds,
    runtime_approval_classes, enforcement_approved_at, enforcement_approved_provider, enforcement_approved_model
  ) values (
    p_sandbox, v_mode, v_provider, v_model, coalesce((s ->> 'timeoutMs')::integer, 500),
    array(select jsonb_array_elements_text(coalesce(s -> 'requiredClasses', '[]'::jsonb))),
    coalesce((s ->> 'capabilityTtlSeconds')::integer, 60),
    array(select jsonb_array_elements_text(coalesce(s -> 'approvalClasses', '[]'::jsonb))),
    case when v_mode = 'enforce' then now() end, case when v_mode = 'enforce' then v_provider end,
    case when v_mode = 'enforce' then v_model end
  );

  if p_spec ? 'github' then
    v_inst := gen_random_uuid();
    v_inst_gh := nextval('gateway.vl_installation_seq');
    insert into public.github_installations (id, tenant_id, github_installation_id, mode, account_login, account_type, github_account_id,
      repository_selection, granted_permissions, status)
    values (v_inst, p_sandbox, v_inst_gh, 'mock', 'validation-org', 'Organization', 1, 'selected',
      '{"contents":"write","issues":"read","metadata":"read","pull_requests":"write"}'::jsonb, 'active');
    for r in select e.value from jsonb_array_elements(p_spec -> 'github' -> 'repos') e loop
      v_i := v_i + 1;
      v_repo := gen_random_uuid();
      insert into public.github_repositories (id, tenant_id, installation_row_id, github_repository_id, owner, name, default_branch, is_private,
        allowed, allowed_at)
      values (v_repo, p_sandbox, v_inst, v_i, r ->> 'owner', r ->> 'name', coalesce(r ->> 'defaultBranch', 'main'), true,
        coalesce((r ->> 'allowed')::boolean, true), case when coalesce((r ->> 'allowed')::boolean, true) then now() end);
      v_repos := v_repos || jsonb_build_object(lower((r ->> 'owner') || '/' || (r ->> 'name')), v_repo);
      if lower((r ->> 'owner') || '/' || (r ->> 'name')) = lower(p_spec -> 'github' ->> 'boundRepo') then v_bound := v_repo; end if;
    end loop;
    if v_bound is not null then
      insert into public.task_repository_bindings (tenant_id, task_id, repository_id, bound_by_principal_id)
      values (p_sandbox, v_task, v_bound, v_principal);
    end if;
  end if;

  return jsonb_build_object('taskId', v_task, 'contractId', v_contract, 'principalId', v_principal, 'agents', v_agents,
    'installationRowId', v_inst, 'repositories', v_repos);
end;
$fn$;
revoke all on function gateway.vl_seed_sandbox(uuid, jsonb) from public;
grant execute on function gateway.vl_seed_sandbox(uuid, jsonb) to authority_gateway;
