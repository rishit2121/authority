-- Correction: install_demo_workspace() marked several of task 991's
-- capabilities 'consumed' even though consumed_uses was well below
-- max_invocations (e.g. push_commits: max_invocations 10, consumed_uses 3,
-- status 'consumed'). 'consumed' should mean exactly what it says — no
-- budget left — and it wasn't true for four of task 991's five
-- capabilities. Task 991 is 'executing', so a task in that state having
-- zero active capabilities was also internally inconsistent with what
-- "still executing" means.
--
-- Found by the existing Playwright kill-switch suite failing against real
-- persisted demo data — those tests assert an active capability exists
-- before termination and a Kill switch confirmation banner exists after,
-- both of which require at least one 'active' row to begin with.
--
-- Fixes the four affected rows (read_issue, read_repository, create_branch,
-- push_commits) to 'active'; open_pull_request stays 'consumed' since it
-- genuinely is (max_invocations 1, consumed_uses 1). Applying this via
-- CREATE OR REPLACE FUNCTION corrects every *future* install; a tenant that
-- already installed demo data before this fix needs an explicit
-- reset_demo_workspace() + install_demo_workspace() to pick it up, since
-- this migration intentionally does not touch already-committed rows in
-- any tenant — see the note in supabase/JSONB_VERSIONING.md's sibling
-- migrations about migrations never mutating tenant data directly.

CREATE OR REPLACE FUNCTION public.install_demo_workspace(p_tenant_id uuid)
 RETURNS TABLE(was_installed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_maya uuid;
  v_security uuid;
  v_agent_coding uuid;
  v_agent_ops uuid;
  v_task_991 uuid;
  v_task_4821 uuid;
  v_contract_991 uuid;
  v_contract_4821 uuid;
  v_plan_991 uuid;
  v_plan_4821 uuid;
  v_node_991_1 uuid; v_node_991_2 uuid; v_node_991_3 uuid; v_node_991_4 uuid;
  v_node_991_5 uuid; v_node_991_6 uuid; v_node_991_7 uuid;
  v_node_4821_1 uuid; v_node_4821_2 uuid; v_node_4821_3 uuid; v_node_4821_4 uuid; v_node_4821_5 uuid;
  v_req_991_1 uuid; v_req_991_2 uuid; v_req_991_3 uuid; v_req_991_4 uuid;
  v_req_991_5 uuid; v_req_991_6 uuid; v_req_991_7 uuid;
  v_req_4821_1 uuid; v_req_4821_2 uuid; v_req_4821_3 uuid; v_req_4821_4 uuid; v_req_4821_5 uuid;
  v_sem_pr uuid; v_sem_workflow uuid;
  v_dec_991_1 uuid; v_dec_991_2 uuid; v_dec_991_3 uuid; v_dec_991_4 uuid;
  v_dec_991_5 uuid; v_dec_991_6 uuid; v_dec_991_7 uuid;
  v_dec_4821_1 uuid; v_dec_4821_2 uuid; v_dec_4821_3 uuid; v_dec_4821_4 uuid; v_dec_4821_5 uuid;
  v_cap_991_1 uuid; v_cap_991_2 uuid; v_cap_991_3 uuid; v_cap_991_4 uuid; v_cap_991_5 uuid;
  v_cap_4821_1 uuid; v_cap_4821_2 uuid; v_cap_4821_3 uuid; v_cap_4821_4 uuid;
begin
  if not authz.can_manage_tenant(p_tenant_id) then
    raise exception 'insufficient privileges to install demo data for this tenant'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.demo_install:' || p_tenant_id::text, 0));

  if exists (
    select 1 from public.tasks where tenant_id = p_tenant_id and demo_key = 'demo:task:991'
  ) then
    return query select false;
    return;
  end if;

  -- Principals ---------------------------------------------------------
  insert into public.principals (tenant_id, kind, display_name, email, demo_key)
  values (p_tenant_id, 'human', 'Maya Okafor', 'maya@northwind.example', 'demo:principal:maya')
  returning id into v_maya;

  insert into public.principals (tenant_id, kind, display_name, email, demo_key)
  values (p_tenant_id, 'human', 'Platform Security', 'security@northwind.example', 'demo:principal:security')
  returning id into v_security;

  -- Agents ---------------------------------------------------------------
  insert into public.agents (
    tenant_id, name, description, model_provider, model, framework,
    owner_principal_id, risk_tier, status, demo_key
  )
  values (
    p_tenant_id, 'coding-agent-17', 'Resolves GitHub issues and opens pull requests.',
    'openai', 'gpt-4.1', 'langchain', v_maya, 'medium', 'active', 'demo:agent:coding'
  )
  returning id into v_agent_coding;

  insert into public.agents (
    tenant_id, name, description, model_provider, model, framework,
    owner_principal_id, risk_tier, status, demo_key
  )
  values (
    p_tenant_id, 'customer-ops-agent', 'Handles refunds and customer confirmation email.',
    'anthropic', 'claude-3-5-sonnet', 'custom', v_maya, 'medium', 'active', 'demo:agent:customer-ops'
  )
  returning id into v_agent_ops;

  -- Task 991: resolve GitHub issue and open a pull request --------------
  insert into public.tasks (tenant_id, agent_id, principal_id, intent, status, started_at, demo_key)
  values (
    p_tenant_id, v_agent_coding, v_maya,
    'Resolve issue #991 in payments-api and open a pull request.',
    'executing', now() - interval '20 minutes', 'demo:task:991'
  )
  returning id into v_task_991;

  insert into public.task_authority_contracts (
    tenant_id, task_id, version, spec_version, allowed_actions, forbidden_resources,
    ephemeral_limits, contract_status, demo_key
  )
  values (
    p_tenant_id, v_task_991, 1, 'v1',
    jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
      jsonb_build_object('tool', 'github.read_issue', 'constraints', jsonb_build_array()),
      jsonb_build_object('tool', 'github.read_repository', 'constraints', jsonb_build_array()),
      jsonb_build_object('tool', 'github.create_branch', 'constraints',
        jsonb_build_array(jsonb_build_object('key', 'branch', 'matches', 'fix-*'))),
      jsonb_build_object('tool', 'github.push_commits', 'constraints',
        jsonb_build_array(jsonb_build_object('key', 'branch', 'matches', 'fix-*'))),
      jsonb_build_object('tool', 'github.open_pull_request', 'constraints',
        jsonb_build_array(jsonb_build_object('key', 'target_branch', 'equals', 'main')),
        'maxInvocations', 1)
    )),
    array['*secret*', '*credentials*'],
    jsonb_build_object('schemaVersion', 1, 'maxToolInvocations', 20, 'expiresInSeconds', 3600),
    'active', 'demo:contract:991'
  )
  returning id into v_contract_991;

  insert into public.plans (tenant_id, task_id, proposed_at, demo_key)
  values (p_tenant_id, v_task_991, now() - interval '19 minutes', 'demo:plan:991')
  returning id into v_plan_991;

  insert into public.plan_nodes (
    tenant_id, plan_id, node_key, sequence_no, tool, operation, resource,
    normalized_arguments, status, demo_key
  )
  values
    (p_tenant_id, v_plan_991, 'read-issue', 0, 'github.read_issue', 'read_issue', 'payments-api#991',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('issue', '991')),
      'executed', 'demo:node:991:1')
  returning id into v_node_991_1;

  insert into public.plan_nodes (
    tenant_id, plan_id, node_key, sequence_no, tool, operation, resource,
    normalized_arguments, status, demo_key
  )
  values
    (p_tenant_id, v_plan_991, 'read-repository', 1, 'github.read_repository', 'read_repository', 'payments-api',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('repository', 'payments-api')),
      'executed', 'demo:node:991:2')
  returning id into v_node_991_2;

  insert into public.plan_nodes (
    tenant_id, plan_id, node_key, sequence_no, tool, operation, resource,
    normalized_arguments, status, demo_key
  )
  values
    (p_tenant_id, v_plan_991, 'create-branch', 2, 'github.create_branch', 'create_branch', 'fix-991',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('branch', 'fix-991')),
      'executed', 'demo:node:991:3')
  returning id into v_node_991_3;

  insert into public.plan_nodes (
    tenant_id, plan_id, node_key, sequence_no, tool, operation, resource,
    normalized_arguments, status, demo_key
  )
  values
    (p_tenant_id, v_plan_991, 'push-commits', 3, 'github.push_commits', 'push_commits', 'fix-991',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('branch', 'fix-991')),
      'executed', 'demo:node:991:4')
  returning id into v_node_991_4;

  insert into public.plan_nodes (
    tenant_id, plan_id, node_key, sequence_no, tool, operation, resource,
    normalized_arguments, status, rationale, demo_key
  )
  values
    (p_tenant_id, v_plan_991, 'get-secret', 4, 'github.get_repository_secret', 'get_repository_secret',
      'payments-api:DEPLOY_KEY',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('name', 'DEPLOY_KEY')),
      'rejected', 'Matches the contract''s forbidden resource pattern *secret*.', 'demo:node:991:5')
  returning id into v_node_991_5;

  insert into public.plan_nodes (
    tenant_id, plan_id, node_key, sequence_no, tool, operation, resource,
    normalized_arguments, status, demo_key
  )
  values
    (p_tenant_id, v_plan_991, 'open-pr', 5, 'github.open_pull_request', 'open_pull_request', 'main',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('target_branch', 'main')),
      'executed', 'demo:node:991:6')
  returning id into v_node_991_6;

  insert into public.plan_nodes (
    tenant_id, plan_id, node_key, sequence_no, tool, operation, resource,
    normalized_arguments, status, rationale, demo_key
  )
  values
    (p_tenant_id, v_plan_991, 'modify-workflow', 6, 'github.modify_workflow', 'modify_workflow', 'ci.yml',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('workflow', 'ci.yml')),
      'proposed', 'Awaiting Platform Security sign-off before any workflow change runs.', 'demo:node:991:7')
  returning id into v_node_991_7;

  -- Tool requests, task 991 (mirrors the six executed/rejected nodes plus
  -- the pending workflow change) --------------------------------------
  insert into public.tool_requests (
    tenant_id, task_id, plan_id, plan_node_id, agent_id, tool, operation, resource,
    normalized_arguments, idempotency_key, demo_key, requested_at
  ) values
    (p_tenant_id, v_task_991, v_plan_991, v_node_991_1, v_agent_coding, 'github.read_issue',
      'read_issue', 'payments-api#991',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('issue', '991')),
      'demo:991:read-issue', 'demo:req:991:1', now() - interval '18 minutes')
  returning id into v_req_991_1;

  insert into public.tool_requests (
    tenant_id, task_id, plan_id, plan_node_id, agent_id, tool, operation, resource,
    normalized_arguments, idempotency_key, demo_key, requested_at
  ) values
    (p_tenant_id, v_task_991, v_plan_991, v_node_991_2, v_agent_coding, 'github.read_repository',
      'read_repository', 'payments-api',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('repository', 'payments-api')),
      'demo:991:read-repository', 'demo:req:991:2', now() - interval '17 minutes')
  returning id into v_req_991_2;

  insert into public.tool_requests (
    tenant_id, task_id, plan_id, plan_node_id, agent_id, tool, operation, resource,
    normalized_arguments, idempotency_key, demo_key, requested_at
  ) values
    (p_tenant_id, v_task_991, v_plan_991, v_node_991_3, v_agent_coding, 'github.create_branch',
      'create_branch', 'fix-991',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('branch', 'fix-991')),
      'demo:991:create-branch', 'demo:req:991:3', now() - interval '16 minutes')
  returning id into v_req_991_3;

  insert into public.tool_requests (
    tenant_id, task_id, plan_id, plan_node_id, agent_id, tool, operation, resource,
    normalized_arguments, idempotency_key, demo_key, requested_at
  ) values
    (p_tenant_id, v_task_991, v_plan_991, v_node_991_4, v_agent_coding, 'github.push_commits',
      'push_commits', 'fix-991',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('branch', 'fix-991')),
      'demo:991:push-commits', 'demo:req:991:4', now() - interval '15 minutes')
  returning id into v_req_991_4;

  insert into public.tool_requests (
    tenant_id, task_id, plan_id, plan_node_id, agent_id, tool, operation, resource,
    normalized_arguments, idempotency_key, demo_key, requested_at
  ) values
    (p_tenant_id, v_task_991, v_plan_991, v_node_991_5, v_agent_coding, 'github.get_repository_secret',
      'get_repository_secret', 'payments-api:DEPLOY_KEY',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('name', 'DEPLOY_KEY')),
      'demo:991:get-secret', 'demo:req:991:5', now() - interval '14 minutes')
  returning id into v_req_991_5;

  insert into public.tool_requests (
    tenant_id, task_id, plan_id, plan_node_id, agent_id, tool, operation, resource,
    normalized_arguments, idempotency_key, demo_key, requested_at
  ) values
    (p_tenant_id, v_task_991, v_plan_991, v_node_991_6, v_agent_coding, 'github.open_pull_request',
      'open_pull_request', 'main',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('target_branch', 'main')),
      'demo:991:open-pr', 'demo:req:991:6', now() - interval '10 minutes')
  returning id into v_req_991_6;

  insert into public.tool_requests (
    tenant_id, task_id, plan_id, plan_node_id, agent_id, tool, operation, resource,
    normalized_arguments, idempotency_key, demo_key, requested_at
  ) values
    (p_tenant_id, v_task_991, v_plan_991, v_node_991_7, v_agent_coding, 'github.modify_workflow',
      'modify_workflow', 'ci.yml',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('workflow', 'ci.yml')),
      'demo:991:modify-workflow', 'demo:req:991:7', now() - interval '5 minutes')
  returning id into v_req_991_7;

  -- Semantic evidence, task 991 (only for requests that reach step 5 of
  -- evaluate.ts — the hard-denied secret read never consults a provider) --
  insert into public.semantic_decisions (
    tenant_id, task_id, tool_request_id, provider, model, model_version,
    probabilities, confidence, latency_ms, state, demo_key, evaluated_at
  )
  values (
    p_tenant_id, v_task_991, v_req_991_6, 'mock', 'heuristic-v1', '1.0.0',
    jsonb_build_object('schemaVersion', 1, 'taskRelevance', 0.95, 'resourceRelevance', 0.93,
      'scopeExpansion', 0.05, 'externalDisclosure', 0.02, 'planConsistency', 0.97, 'semanticRisk', 0.06),
    0.9, 42, 'ok', 'demo:sem:991:pr', now() - interval '10 minutes'
  )
  returning id into v_sem_pr;

  insert into public.semantic_decisions (
    tenant_id, task_id, tool_request_id, provider, model, model_version,
    probabilities, confidence, latency_ms, state, demo_key, evaluated_at
  )
  values (
    p_tenant_id, v_task_991, v_req_991_7, 'mock', 'heuristic-v1', '1.0.0',
    jsonb_build_object('schemaVersion', 1, 'taskRelevance', 0.4, 'resourceRelevance', 0.35,
      'scopeExpansion', 0.72, 'externalDisclosure', 0.1, 'planConsistency', 0.5, 'semanticRisk', 0.68),
    0.75, 58, 'ok', 'demo:sem:991:workflow', now() - interval '5 minutes'
  )
  returning id into v_sem_workflow;

  -- Decisions, task 991 (6 evaluated tool requests + 1 pending) ----------
  insert into public.authorization_decisions (
    tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome,
    reason_codes, applied_constraints, latency_ms, demo_key, created_at
  ) values
    (p_tenant_id, v_task_991, v_req_991_1, v_contract_991, 1, 'allow',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('code', 'WITHIN_CONTRACT', 'detail',
          'github.read_issue is permitted and its arguments satisfy every contract constraint.',
          'source', 'contract'))),
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array()),
      4, 'demo:dec:991:1', now() - interval '18 minutes')
  returning id into v_dec_991_1;

  insert into public.authorization_decisions (
    tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome,
    reason_codes, applied_constraints, latency_ms, demo_key, created_at
  ) values
    (p_tenant_id, v_task_991, v_req_991_2, v_contract_991, 1, 'allow',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('code', 'WITHIN_CONTRACT', 'detail',
          'github.read_repository is permitted and its arguments satisfy every contract constraint.',
          'source', 'contract'))),
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array()),
      3, 'demo:dec:991:2', now() - interval '17 minutes')
  returning id into v_dec_991_2;

  insert into public.authorization_decisions (
    tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome,
    reason_codes, applied_constraints, latency_ms, demo_key, created_at
  ) values
    (p_tenant_id, v_task_991, v_req_991_3, v_contract_991, 1, 'allow_constrained',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('code', 'WITHIN_CONTRACT', 'detail',
          'github.create_branch is permitted and its arguments satisfy every contract constraint.',
          'source', 'contract'))),
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('key', 'branch', 'matches', 'fix-*'))),
      5, 'demo:dec:991:3', now() - interval '16 minutes')
  returning id into v_dec_991_3;

  insert into public.authorization_decisions (
    tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome,
    reason_codes, applied_constraints, latency_ms, demo_key, created_at
  ) values
    (p_tenant_id, v_task_991, v_req_991_4, v_contract_991, 1, 'allow_constrained',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('code', 'WITHIN_CONTRACT', 'detail',
          'github.push_commits is permitted and its arguments satisfy every contract constraint.',
          'source', 'contract'))),
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('key', 'branch', 'matches', 'fix-*'))),
      6, 'demo:dec:991:4', now() - interval '15 minutes')
  returning id into v_dec_991_4;

  insert into public.authorization_decisions (
    tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome,
    reason_codes, applied_constraints, latency_ms, demo_key, created_at
  ) values
    (p_tenant_id, v_task_991, v_req_991_5, v_contract_991, 1, 'deny',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('code', 'FORBIDDEN_RESOURCE', 'detail',
          'Request matches the contract''s forbidden resource `*secret*`.', 'source', 'policy'))),
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array()),
      2, 'demo:dec:991:5', now() - interval '14 minutes')
  returning id into v_dec_991_5;

  insert into public.authorization_decisions (
    tenant_id, task_id, tool_request_id, contract_id, contract_version, semantic_decision_id, outcome,
    reason_codes, applied_constraints, latency_ms, demo_key, created_at
  ) values
    (p_tenant_id, v_task_991, v_req_991_6, v_contract_991, 1, v_sem_pr, 'allow_constrained',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('code', 'WITHIN_CONTRACT', 'detail',
          'github.open_pull_request is permitted and its arguments satisfy every contract constraint.',
          'source', 'contract'),
        jsonb_build_object('code', 'SEMANTIC_CONSISTENT', 'detail',
          'Semantic evidence is consistent with the user''s task.', 'source', 'semantic'))),
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('key', 'target_branch', 'equals', 'main'))),
      48, 'demo:dec:991:6', now() - interval '10 minutes')
  returning id into v_dec_991_6;

  insert into public.authorization_decisions (
    tenant_id, task_id, tool_request_id, contract_id, contract_version, semantic_decision_id, outcome,
    reason_codes, applied_constraints, latency_ms, demo_key, created_at
  ) values
    (p_tenant_id, v_task_991, v_req_991_7, v_contract_991, 1, v_sem_workflow, 'require_approval',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('code', 'TOOL_NOT_IN_CONTRACT', 'detail',
          'github.modify_workflow is not an allowed action on this Task Authority Contract.',
          'source', 'contract'),
        jsonb_build_object('code', 'SEMANTIC_RISK', 'detail',
          'Aggregate semantic risk 0.68 exceeds threshold; routing for approval.', 'source', 'semantic'))),
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array()),
      61, 'demo:dec:991:7', now() - interval '5 minutes')
  returning id into v_dec_991_7;

  -- Capabilities, task 991 (issued only for the 5 permitting decisions) --
  insert into public.capabilities (
    tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
    status, max_invocations, consumed_uses, issued_at, expires_at, demo_key
  ) values
    (p_tenant_id, v_task_991, v_dec_991_1, v_agent_coding, 'github.read_issue',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array()),
      'active', 5, 1, now() - interval '18 minutes', now() + interval '40 minutes', 'demo:cap:991:1')
  returning id into v_cap_991_1;

  insert into public.capabilities (
    tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
    status, max_invocations, consumed_uses, issued_at, expires_at, demo_key
  ) values
    (p_tenant_id, v_task_991, v_dec_991_2, v_agent_coding, 'github.read_repository',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array()),
      'active', 5, 1, now() - interval '17 minutes', now() + interval '40 minutes', 'demo:cap:991:2')
  returning id into v_cap_991_2;

  insert into public.capabilities (
    tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
    status, max_invocations, consumed_uses, issued_at, expires_at, demo_key
  ) values
    (p_tenant_id, v_task_991, v_dec_991_3, v_agent_coding, 'github.create_branch',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('key', 'branch', 'matches', 'fix-*'))),
      'active', 3, 1, now() - interval '16 minutes', now() + interval '40 minutes', 'demo:cap:991:3')
  returning id into v_cap_991_3;

  insert into public.capabilities (
    tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
    status, max_invocations, consumed_uses, issued_at, expires_at, demo_key
  ) values
    (p_tenant_id, v_task_991, v_dec_991_4, v_agent_coding, 'github.push_commits',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('key', 'branch', 'matches', 'fix-*'))),
      'active', 10, 3, now() - interval '15 minutes', now() + interval '40 minutes', 'demo:cap:991:4')
  returning id into v_cap_991_4;

  insert into public.capabilities (
    tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
    status, max_invocations, consumed_uses, issued_at, expires_at, demo_key
  ) values
    (p_tenant_id, v_task_991, v_dec_991_6, v_agent_coding, 'github.open_pull_request',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('key', 'target_branch', 'equals', 'main'))),
      'consumed', 1, 1, now() - interval '10 minutes', now() + interval '40 minutes', 'demo:cap:991:5')
  returning id into v_cap_991_5;

  -- Approval, task 991 (the one approval in the whole demo dataset) ------
  insert into public.approvals (
    tenant_id, task_id, authorization_decision_id, requested_from_principal_id,
    status, summary, requested_at, demo_key
  ) values (
    p_tenant_id, v_task_991, v_dec_991_7, v_security, 'pending',
    'coding-agent-17 requested to modify ci.yml, outside the task''s contract. Routed to Platform Security for sign-off.',
    now() - interval '5 minutes', 'demo:approval:991:workflow'
  );

  -- Events, task 991 ------------------------------------------------------
  insert into public.execution_events (
    tenant_id, task_id, event_type, result_status, summary, demo_key, created_at
  ) values
    (p_tenant_id, v_task_991, 'task_received', 'info',
      'Trusted intent received from Maya Okafor: resolve issue #991 and open a pull request.',
      'demo:event:991:1', now() - interval '20 minutes'),
    (p_tenant_id, v_task_991, 'contract_issued', 'info',
      'Task Authority Contract v1 issued: 5 allowed actions, forbidden secrets/credentials, 20-invocation budget.',
      'demo:event:991:2', now() - interval '19 minutes'),
    (p_tenant_id, v_task_991, 'plan_proposed', 'info',
      'coding-agent-17 proposed a 7-step plan.', 'demo:event:991:3', now() - interval '19 minutes');

  insert into public.execution_events (
    tenant_id, task_id, decision_id, event_type, result_status, summary, demo_key, created_at
  ) values
    (p_tenant_id, v_task_991, v_dec_991_1, 'request_evaluated', 'success',
      'github.read_issue allowed.', 'demo:event:991:4', now() - interval '18 minutes'),
    (p_tenant_id, v_task_991, v_dec_991_2, 'request_evaluated', 'success',
      'github.read_repository allowed.', 'demo:event:991:5', now() - interval '17 minutes');

  insert into public.execution_events (
    tenant_id, task_id, capability_id, decision_id, event_type, result_status, summary, demo_key, created_at
  ) values
    (p_tenant_id, v_task_991, v_cap_991_3, v_dec_991_3, 'capability_issued', 'success',
      'Capability issued for github.create_branch, constrained to branch fix-991.',
      'demo:event:991:6', now() - interval '16 minutes'),
    (p_tenant_id, v_task_991, v_cap_991_3, v_dec_991_3, 'tool_invoked', 'success',
      'Branch fix-991 created.', 'demo:event:991:7', now() - interval '16 minutes'),
    (p_tenant_id, v_task_991, v_cap_991_4, v_dec_991_4, 'capability_issued', 'success',
      'Capability issued for github.push_commits, constrained to branch fix-991.',
      'demo:event:991:8', now() - interval '15 minutes'),
    (p_tenant_id, v_task_991, v_cap_991_4, v_dec_991_4, 'tool_invoked', 'success',
      'Commits pushed to fix-991.', 'demo:event:991:9', now() - interval '15 minutes');

  insert into public.execution_events (
    tenant_id, task_id, decision_id, event_type, result_status, summary, demo_key, created_at
  ) values
    (p_tenant_id, v_task_991, v_dec_991_5, 'request_evaluated', 'blocked',
      'github.get_repository_secret denied — matches forbidden resource *secret*. No capability was issued.',
      'demo:event:991:10', now() - interval '14 minutes');

  insert into public.execution_events (
    tenant_id, task_id, capability_id, decision_id, event_type, result_status, summary, demo_key, created_at
  ) values
    (p_tenant_id, v_task_991, v_cap_991_5, v_dec_991_6, 'capability_issued', 'success',
      'Capability issued for github.open_pull_request targeting main, single use.',
      'demo:event:991:11', now() - interval '10 minutes'),
    (p_tenant_id, v_task_991, v_cap_991_5, v_dec_991_6, 'tool_invoked', 'success',
      'Pull request opened against main.', 'demo:event:991:12', now() - interval '10 minutes');

  insert into public.execution_events (
    tenant_id, task_id, decision_id, event_type, result_status, summary, demo_key, created_at
  ) values
    (p_tenant_id, v_task_991, v_dec_991_7, 'approval_requested', 'blocked',
      'github.modify_workflow requires human sign-off before it can run.',
      'demo:event:991:13', now() - interval '5 minutes');

  -- Task 4821: refund order and email confirmation -----------------------
  insert into public.tasks (tenant_id, agent_id, principal_id, intent, status, started_at, completed_at, demo_key)
  values (
    p_tenant_id, v_agent_ops, v_maya,
    'Refund order #4821 and email the customer a confirmation.',
    'completed', now() - interval '2 hours', now() - interval '1 hour 55 minutes', 'demo:task:4821'
  )
  returning id into v_task_4821;

  insert into public.task_authority_contracts (
    tenant_id, task_id, version, spec_version, allowed_actions, forbidden_resources,
    ephemeral_limits, contract_status, demo_key
  )
  values (
    p_tenant_id, v_task_4821, 1, 'v1',
    jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
      jsonb_build_object('tool', 'postgres.query_order', 'constraints',
        jsonb_build_array(jsonb_build_object('key', 'order_id', 'equals', '4821'))),
      jsonb_build_object('tool', 'stripe.retrieve_payment', 'constraints',
        jsonb_build_array(jsonb_build_object('key', 'order_id', 'equals', '4821'))),
      jsonb_build_object('tool', 'stripe.create_refund', 'constraints',
        jsonb_build_array(jsonb_build_object('key', 'order_id', 'equals', '4821')), 'maxInvocations', 1),
      jsonb_build_object('tool', 'gmail.send_email', 'constraints',
        jsonb_build_array(jsonb_build_object('key', 'to', 'matches', '*@customer.example')),
        'maxInvocations', 1)
    )),
    array['slack.*'],
    jsonb_build_object('schemaVersion', 1, 'maxToolInvocations', 10, 'expiresInSeconds', 1800),
    'active', 'demo:contract:4821'
  )
  returning id into v_contract_4821;

  insert into public.plans (tenant_id, task_id, proposed_at, demo_key)
  values (p_tenant_id, v_task_4821, now() - interval '1 hour 58 minutes', 'demo:plan:4821')
  returning id into v_plan_4821;

  insert into public.plan_nodes (
    tenant_id, plan_id, node_key, sequence_no, tool, operation, resource,
    normalized_arguments, status, demo_key
  ) values
    (p_tenant_id, v_plan_4821, 'query-order', 0, 'postgres.query_order', 'query_order', 'order:4821',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('order_id', '4821')),
      'executed', 'demo:node:4821:1')
  returning id into v_node_4821_1;

  insert into public.plan_nodes (
    tenant_id, plan_id, node_key, sequence_no, tool, operation, resource,
    normalized_arguments, status, demo_key
  ) values
    (p_tenant_id, v_plan_4821, 'retrieve-payment', 1, 'stripe.retrieve_payment', 'retrieve_payment', 'order:4821',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('order_id', '4821')),
      'executed', 'demo:node:4821:2')
  returning id into v_node_4821_2;

  insert into public.plan_nodes (
    tenant_id, plan_id, node_key, sequence_no, tool, operation, resource,
    normalized_arguments, status, demo_key
  ) values
    (p_tenant_id, v_plan_4821, 'create-refund', 2, 'stripe.create_refund', 'create_refund', 'order:4821',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('order_id', '4821')),
      'executed', 'demo:node:4821:3')
  returning id into v_node_4821_3;

  insert into public.plan_nodes (
    tenant_id, plan_id, node_key, sequence_no, tool, operation, resource,
    normalized_arguments, status, rationale, demo_key
  ) values
    (p_tenant_id, v_plan_4821, 'notify-slack', 3, 'slack.post_message', 'post_message', '#ops',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('channel', '#ops')),
      'rejected', 'Matches the contract''s forbidden resource pattern slack.*.', 'demo:node:4821:4')
  returning id into v_node_4821_4;

  insert into public.plan_nodes (
    tenant_id, plan_id, node_key, sequence_no, tool, operation, resource,
    normalized_arguments, status, demo_key
  ) values
    (p_tenant_id, v_plan_4821, 'send-email', 4, 'gmail.send_email', 'send_email', 'customer@customer.example',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('to', 'customer@customer.example')),
      'executed', 'demo:node:4821:5')
  returning id into v_node_4821_5;

  insert into public.tool_requests (
    tenant_id, task_id, plan_id, plan_node_id, agent_id, tool, operation, resource,
    normalized_arguments, idempotency_key, demo_key, requested_at
  ) values
    (p_tenant_id, v_task_4821, v_plan_4821, v_node_4821_1, v_agent_ops, 'postgres.query_order',
      'query_order', 'order:4821',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('order_id', '4821')),
      'demo:4821:query-order', 'demo:req:4821:1', now() - interval '1 hour 57 minutes')
  returning id into v_req_4821_1;

  insert into public.tool_requests (
    tenant_id, task_id, plan_id, plan_node_id, agent_id, tool, operation, resource,
    normalized_arguments, idempotency_key, demo_key, requested_at
  ) values
    (p_tenant_id, v_task_4821, v_plan_4821, v_node_4821_2, v_agent_ops, 'stripe.retrieve_payment',
      'retrieve_payment', 'order:4821',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('order_id', '4821')),
      'demo:4821:retrieve-payment', 'demo:req:4821:2', now() - interval '1 hour 56 minutes')
  returning id into v_req_4821_2;

  insert into public.tool_requests (
    tenant_id, task_id, plan_id, plan_node_id, agent_id, tool, operation, resource,
    normalized_arguments, idempotency_key, demo_key, requested_at
  ) values
    (p_tenant_id, v_task_4821, v_plan_4821, v_node_4821_3, v_agent_ops, 'stripe.create_refund',
      'create_refund', 'order:4821',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('order_id', '4821')),
      'demo:4821:create-refund', 'demo:req:4821:3', now() - interval '1 hour 56 minutes')
  returning id into v_req_4821_3;

  insert into public.tool_requests (
    tenant_id, task_id, plan_id, plan_node_id, agent_id, tool, operation, resource,
    normalized_arguments, idempotency_key, demo_key, requested_at
  ) values
    (p_tenant_id, v_task_4821, v_plan_4821, v_node_4821_4, v_agent_ops, 'slack.post_message',
      'post_message', '#ops',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('channel', '#ops')),
      'demo:4821:notify-slack', 'demo:req:4821:4', now() - interval '1 hour 55 minutes')
  returning id into v_req_4821_4;

  insert into public.tool_requests (
    tenant_id, task_id, plan_id, plan_node_id, agent_id, tool, operation, resource,
    normalized_arguments, idempotency_key, demo_key, requested_at
  ) values
    (p_tenant_id, v_task_4821, v_plan_4821, v_node_4821_5, v_agent_ops, 'gmail.send_email',
      'send_email', 'customer@customer.example',
      jsonb_build_object('schemaVersion', 1, 'values', jsonb_build_object('to', 'customer@customer.example')),
      'demo:4821:send-email', 'demo:req:4821:5', now() - interval '1 hour 55 minutes')
  returning id into v_req_4821_5;

  insert into public.authorization_decisions (
    tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome,
    reason_codes, applied_constraints, latency_ms, demo_key, created_at
  ) values
    (p_tenant_id, v_task_4821, v_req_4821_1, v_contract_4821, 1, 'allow_constrained',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('code', 'WITHIN_CONTRACT', 'detail',
          'postgres.query_order is permitted and its arguments satisfy every contract constraint.',
          'source', 'contract'))),
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('key', 'order_id', 'equals', '4821'))),
      3, 'demo:dec:4821:1', now() - interval '1 hour 57 minutes')
  returning id into v_dec_4821_1;

  insert into public.authorization_decisions (
    tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome,
    reason_codes, applied_constraints, latency_ms, demo_key, created_at
  ) values
    (p_tenant_id, v_task_4821, v_req_4821_2, v_contract_4821, 1, 'allow_constrained',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('code', 'WITHIN_CONTRACT', 'detail',
          'stripe.retrieve_payment is permitted and its arguments satisfy every contract constraint.',
          'source', 'contract'))),
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('key', 'order_id', 'equals', '4821'))),
      4, 'demo:dec:4821:2', now() - interval '1 hour 56 minutes')
  returning id into v_dec_4821_2;

  insert into public.authorization_decisions (
    tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome,
    reason_codes, applied_constraints, latency_ms, demo_key, created_at
  ) values
    (p_tenant_id, v_task_4821, v_req_4821_3, v_contract_4821, 1, 'allow_constrained',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('code', 'WITHIN_CONTRACT', 'detail',
          'stripe.create_refund is permitted and its arguments satisfy every contract constraint.',
          'source', 'contract'))),
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('key', 'order_id', 'equals', '4821'))),
      5, 'demo:dec:4821:3', now() - interval '1 hour 56 minutes')
  returning id into v_dec_4821_3;

  insert into public.authorization_decisions (
    tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome,
    reason_codes, applied_constraints, latency_ms, demo_key, created_at
  ) values
    (p_tenant_id, v_task_4821, v_req_4821_4, v_contract_4821, 1, 'deny',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('code', 'FORBIDDEN_RESOURCE', 'detail',
          'Request matches the contract''s forbidden resource `slack.*`.', 'source', 'policy'))),
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array()),
      2, 'demo:dec:4821:4', now() - interval '1 hour 55 minutes')
  returning id into v_dec_4821_4;

  insert into public.authorization_decisions (
    tenant_id, task_id, tool_request_id, contract_id, contract_version, outcome,
    reason_codes, applied_constraints, latency_ms, demo_key, created_at
  ) values
    (p_tenant_id, v_task_4821, v_req_4821_5, v_contract_4821, 1, 'allow_constrained',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('code', 'WITHIN_CONTRACT', 'detail',
          'gmail.send_email is permitted and its arguments satisfy every contract constraint.',
          'source', 'contract'))),
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('key', 'to', 'matches', '*@customer.example'))),
      6, 'demo:dec:4821:5', now() - interval '1 hour 55 minutes')
  returning id into v_dec_4821_5;

  insert into public.capabilities (
    tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
    status, max_invocations, consumed_uses, issued_at, expires_at, revoked_at, revocation_reason, demo_key
  ) values
    (p_tenant_id, v_task_4821, v_dec_4821_1, v_agent_ops, 'postgres.query_order',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('key', 'order_id', 'equals', '4821'))),
      'expired', 3, 1, now() - interval '1 hour 57 minutes', now() - interval '1 hour 27 minutes',
      null, null, 'demo:cap:4821:1')
  returning id into v_cap_4821_1;

  insert into public.capabilities (
    tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
    status, max_invocations, consumed_uses, issued_at, expires_at, demo_key
  ) values
    (p_tenant_id, v_task_4821, v_dec_4821_2, v_agent_ops, 'stripe.retrieve_payment',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('key', 'order_id', 'equals', '4821'))),
      'expired', 3, 1, now() - interval '1 hour 56 minutes', now() - interval '1 hour 26 minutes',
      'demo:cap:4821:2')
  returning id into v_cap_4821_2;

  insert into public.capabilities (
    tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
    status, max_invocations, consumed_uses, issued_at, expires_at, demo_key
  ) values
    (p_tenant_id, v_task_4821, v_dec_4821_3, v_agent_ops, 'stripe.create_refund',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('key', 'order_id', 'equals', '4821'))),
      'consumed', 1, 1, now() - interval '1 hour 56 minutes', now() - interval '1 hour 26 minutes',
      'demo:cap:4821:3')
  returning id into v_cap_4821_3;

  insert into public.capabilities (
    tenant_id, task_id, authorization_decision_id, agent_id, tool, resource_constraints,
    status, max_invocations, consumed_uses, issued_at, expires_at, demo_key
  ) values
    (p_tenant_id, v_task_4821, v_dec_4821_5, v_agent_ops, 'gmail.send_email',
      jsonb_build_object('schemaVersion', 1, 'items', jsonb_build_array(
        jsonb_build_object('key', 'to', 'matches', '*@customer.example'))),
      'consumed', 1, 1, now() - interval '1 hour 55 minutes', now() - interval '1 hour 25 minutes',
      'demo:cap:4821:4')
  returning id into v_cap_4821_4;

  insert into public.execution_events (
    tenant_id, task_id, event_type, result_status, summary, demo_key, created_at
  ) values
    (p_tenant_id, v_task_4821, 'task_received', 'info',
      'Trusted intent received: refund order #4821 and email the customer a confirmation.',
      'demo:event:4821:1', now() - interval '2 hours'),
    (p_tenant_id, v_task_4821, 'contract_issued', 'info',
      'Task Authority Contract v1 issued: 4 allowed actions, forbidden slack.*, 10-invocation budget.',
      'demo:event:4821:2', now() - interval '1 hour 58 minutes'),
    (p_tenant_id, v_task_4821, 'plan_proposed', 'info',
      'customer-ops-agent proposed a 5-step plan.', 'demo:event:4821:3', now() - interval '1 hour 58 minutes');

  insert into public.execution_events (
    tenant_id, task_id, capability_id, decision_id, event_type, result_status, summary, demo_key, created_at
  ) values
    (p_tenant_id, v_task_4821, v_cap_4821_1, v_dec_4821_1, 'capability_issued', 'success',
      'Capability issued for postgres.query_order, constrained to order 4821.',
      'demo:event:4821:4', now() - interval '1 hour 57 minutes'),
    (p_tenant_id, v_task_4821, v_cap_4821_1, v_dec_4821_1, 'tool_invoked', 'success',
      'Order 4821 retrieved.', 'demo:event:4821:5', now() - interval '1 hour 57 minutes'),
    (p_tenant_id, v_task_4821, v_cap_4821_2, v_dec_4821_2, 'capability_issued', 'success',
      'Capability issued for stripe.retrieve_payment, constrained to order 4821.',
      'demo:event:4821:6', now() - interval '1 hour 56 minutes'),
    (p_tenant_id, v_task_4821, v_cap_4821_2, v_dec_4821_2, 'tool_invoked', 'success',
      'Original payment retrieved.', 'demo:event:4821:7', now() - interval '1 hour 56 minutes'),
    (p_tenant_id, v_task_4821, v_cap_4821_3, v_dec_4821_3, 'capability_issued', 'success',
      'Capability issued for stripe.create_refund, single use.',
      'demo:event:4821:8', now() - interval '1 hour 56 minutes'),
    (p_tenant_id, v_task_4821, v_cap_4821_3, v_dec_4821_3, 'tool_invoked', 'success',
      'Refund issued for order 4821.', 'demo:event:4821:9', now() - interval '1 hour 56 minutes');

  insert into public.execution_events (
    tenant_id, task_id, decision_id, event_type, result_status, summary, demo_key, created_at
  ) values
    (p_tenant_id, v_task_4821, v_dec_4821_4, 'request_evaluated', 'blocked',
      'slack.post_message denied — matches forbidden resource slack.*. No capability was issued.',
      'demo:event:4821:10', now() - interval '1 hour 55 minutes');

  insert into public.execution_events (
    tenant_id, task_id, capability_id, decision_id, event_type, result_status, summary, demo_key, created_at
  ) values
    (p_tenant_id, v_task_4821, v_cap_4821_4, v_dec_4821_5, 'capability_issued', 'success',
      'Capability issued for gmail.send_email, single use, recipient domain constrained.',
      'demo:event:4821:11', now() - interval '1 hour 55 minutes'),
    (p_tenant_id, v_task_4821, v_cap_4821_4, v_dec_4821_5, 'tool_invoked', 'success',
      'Confirmation email sent to the customer.', 'demo:event:4821:12', now() - interval '1 hour 55 minutes');

  insert into public.execution_events (
    tenant_id, task_id, event_type, result_status, summary, demo_key, created_at
  ) values
    (p_tenant_id, v_task_4821, 'task_completed', 'success',
      'Task completed: refund issued and confirmation email sent.',
      'demo:event:4821:13', now() - interval '1 hour 55 minutes');

  -- Policies: one active, one draft ---------------------------------------
  insert into public.policies (
    tenant_id, name, description, version, status, effect, conditions, demo_key, created_at, activated_at
  ) values (
    p_tenant_id, 'Never read repository secrets',
    'Hard denial on any resource matching a secret or credential pattern.',
    1, 'active', 'deny',
    jsonb_build_object('schemaVersion', 1, 'rules', jsonb_build_array(
      jsonb_build_object('key', 'resource', 'matches', '*secret*'))),
    'demo:policy:no-secrets', now() - interval '90 days', now() - interval '90 days'
  );

  insert into public.policies (
    tenant_id, name, description, version, status, effect, conditions, demo_key, created_at
  ) values (
    p_tenant_id, 'CI workflow changes require review',
    'Draft: routes any github.modify_workflow request to Platform Security instead of a hard deny.',
    1, 'draft', 'deny',
    jsonb_build_object('schemaVersion', 1, 'rules', jsonb_build_array(
      jsonb_build_object('key', 'tool', 'matches', 'github.modify_workflow'))),
    'demo:policy:workflow-review', now() - interval '2 days'
  );

  -- Integration metadata ---------------------------------------------------
  insert into public.integrations (tenant_id, provider, display_name, status, demo_key) values
    (p_tenant_id, 'github', 'GitHub', 'connected', 'demo:integration:github'),
    (p_tenant_id, 'stripe', 'Stripe', 'connected', 'demo:integration:stripe'),
    (p_tenant_id, 'gmail', 'Gmail', 'connected', 'demo:integration:gmail'),
    (p_tenant_id, 'postgres', 'PostgreSQL (read replica)', 'warning', 'demo:integration:postgres'),
    (p_tenant_id, 'slack', 'Slack', 'not_connected', 'demo:integration:slack');

  return query select true;
end;
$function$

