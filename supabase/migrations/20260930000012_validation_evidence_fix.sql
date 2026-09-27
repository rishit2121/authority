-- Part 8: tool_requests records `requested_at`, not `created_at`.

create or replace function gateway.vl_evidence(p_sandbox uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform gateway.vl_assert_sandbox(p_sandbox);
  return jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at) from (
        select tr.id as tool_request_id, tr.tool, tr.idempotency_key, ad.outcome::text as deterministic_outcome, fd.final_outcome::text as final_outcome,
               fd.narrowed, fd.semantic_mode::text as semantic_mode, fd.semantic_policy, fd.degraded, fd.degraded_reason, fd.composition_reasons,
               ad.reason_codes -> 'items' as reason_items, se.state::text as semantic_state, se.risk_level::text as semantic_risk,
               se.provider as semantic_provider, se.indicators as semantic_indicators, se.latency_ms as semantic_latency_ms,
               ct.id as capability_id, ct.status as capability_status, ct.uses, ct.reserved_uses, ct.max_uses, ct.approval_request_id, tr.requested_at as created_at
        from public.tool_requests tr
        left join public.authorization_decisions ad on ad.tool_request_id = tr.id
        left join public.final_decisions fd on fd.authorization_decision_id = ad.id
        left join public.semantic_evaluations se on se.authorization_decision_id = ad.id
        left join public.capability_tokens ct on ct.authorization_decision_id = ad.id
        where tr.tenant_id = p_sandbox) x), '[]'::jsonb),
    'reservations', coalesce((select jsonb_agg(jsonb_build_object('tool', r.tool, 'status', r.status, 'mode', r.execution_mode, 'reason', r.reason_code)
                                                order by r.created_at) from public.capability_reservations r where r.tenant_id = p_sandbox), '[]'::jsonb),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('tool', g.tool, 'category', g.result_category, 'mode', g.execution_mode, 'reason', g.reason_code)
                                             order by g.created_at) from public.github_execution_receipts g where g.tenant_id = p_sandbox), '[]'::jsonb),
    'approvals', coalesce((select jsonb_agg(jsonb_build_object('tool', a.tool, 'status', a.status, 'stale_reason', a.stale_reason, 'required', a.required_approvals)
                                              order by a.created_at) from public.runtime_approval_requests a where a.tenant_id = p_sandbox), '[]'::jsonb)
  );
end;
$fn$;
revoke all on function gateway.vl_evidence(uuid) from public;
grant execute on function gateway.vl_evidence(uuid) to authority_gateway;
