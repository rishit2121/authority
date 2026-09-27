-- Part 7: approver identity is the signed-in USER: self-approval and distinct-approver rules
-- consider every principal row a user holds.

create or replace function public.decide_runtime_approval(p_request_id uuid, p_decision text, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  ar public.runtime_approval_requests%rowtype;
  v_principal uuid;
  v_task_principal uuid;
  v_task_user uuid;
  v_agent_owner uuid;
  v_approvals integer;
  v_reason text;
begin
  if (select auth.uid()) is null then
    raise exception 'decide_runtime_approval() requires an authenticated caller' using errcode = '28000';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject' using errcode = '22023';
  end if;
  select * into ar from public.runtime_approval_requests where id = p_request_id;
  if ar.id is null or not authz.is_member_of(ar.tenant_id) then
    raise exception 'approval request not found' using errcode = 'P0002';
  end if;
  if not authz.has_min_role(ar.tenant_id, 'security_admin') then
    raise exception 'insufficient privileges to decide approvals' using errcode = '42501';
  end if;
  select p.id into v_principal from public.principals p
  where p.tenant_id = ar.tenant_id and p.user_id = (select auth.uid()) order by p.created_at, p.id limit 1;
  if v_principal is null then
    raise exception 'no principal for the current user' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('authority.runtime_approval:' || ar.id::text, 0));
  select * into ar from public.runtime_approval_requests where id = p_request_id;

  if ar.status = 'pending' and ar.expires_at <= now() then
    update public.runtime_approval_requests set status = 'expired', resolved_at = now() where id = ar.id;
    return 'expired';
  end if;
  if ar.status <> 'pending' then return ar.status; end if;

  -- Self-approval: neither the task's principal, its initiating user, nor the agent's owner may decide.
  select t.principal_id, t.initiating_user_id into v_task_principal, v_task_user from public.tasks t where t.id = ar.task_id;
  select ag.owner_principal_id into v_agent_owner from public.agents ag where ag.id = ar.agent_id;
  -- Any principal this USER holds counts: a person cannot dodge the rule through a second principal row.
  if exists (select 1 from public.principals mine
             where mine.tenant_id = ar.tenant_id and mine.user_id = (select auth.uid())
               and mine.id in (v_task_principal, v_agent_owner))
     or v_task_user = (select auth.uid()) then
    raise exception 'you cannot decide an approval for a task or agent you own' using errcode = '42501';
  end if;
  -- Distinct approvers means distinct PEOPLE: compare users, not principal rows.
  if exists (select 1 from public.runtime_approval_decisions d
             join public.principals dp on dp.id = d.approver_principal_id and dp.tenant_id = d.tenant_id
             where d.request_id = ar.id and dp.user_id = (select auth.uid())) then
    raise exception 'you have already decided this approval' using errcode = '23505';
  end if;

  -- Stale-at-decision: anything the approver was shown that has since changed.
  if gateway.approval_context_hash(ar.tenant_id, ar.task_id, ar.tool, ar.resource) <> ar.context_hash then
    v_reason := 'CONTEXT_CHANGED';
    update public.runtime_approval_requests set status = 'stale', stale_reason = v_reason, resolved_at = now() where id = ar.id;
    return 'stale';
  end if;

  insert into public.runtime_approval_decisions (tenant_id, request_id, approver_principal_id, decision, note)
  values (ar.tenant_id, ar.id, v_principal, p_decision, nullif(btrim(p_note), ''));

  if p_decision = 'reject' then
    update public.runtime_approval_requests set status = 'rejected', resolved_at = now() where id = ar.id;
    insert into public.execution_events (tenant_id, task_id, tool_request_id, decision_id, event_type, result_status, summary,
      normalized_effect_metadata)
    values (ar.tenant_id, ar.task_id, ar.tool_request_id, ar.authorization_decision_id, 'approval_resolved', 'blocked',
      format('Approval for %s was rejected.', ar.tool), jsonb_build_object('schemaVersion', 1, 'phase', 'approval_rejected'));
    return 'rejected';
  end if;

  select count(*) into v_approvals from public.runtime_approval_decisions d where d.request_id = ar.id and d.decision = 'approve';
  if v_approvals >= ar.required_approvals then
    update public.runtime_approval_requests set status = 'approved', resolved_at = now() where id = ar.id;
    insert into public.execution_events (tenant_id, task_id, tool_request_id, decision_id, event_type, result_status, summary,
      normalized_effect_metadata)
    values (ar.tenant_id, ar.task_id, ar.tool_request_id, ar.authorization_decision_id, 'approval_resolved', 'success',
      format('Approval for %s was granted; the agent may now re-request the capability.', ar.tool),
      jsonb_build_object('schemaVersion', 1, 'phase', 'approval_granted'));
    return 'approved';
  end if;
  return 'pending';
end;
$fn$;
revoke all on function public.decide_runtime_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_runtime_approval(uuid, text, text) to authenticated;
