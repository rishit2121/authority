-- Security review finding: a security_admin could activate a draft policy
-- directly, with no dedicated validation or audit path, because the UPDATE
-- policy's WITH CHECK clause constrained only the caller's role — not the
-- resulting `status` — while the USING clause constrained only the *old*
-- row (must currently be draft). The immutability trigger in
-- 20260923000009_lifecycle_triggers.sql correctly blocks any further change
-- once a row reaches 'active', but nothing blocked the transition *into*
-- 'active' itself.
--
-- Verified exploitable directly: signed in as tenant A's owner
-- (security_admin and above), a single UPDATE on the draft policy
-- 'CI workflow changes require review' setting status = 'active' and
-- activated_at = now() succeeded — in the same statement that could also
-- have rewritten `conditions`, `effect` or `name`, so a security_admin could
-- publish arbitrary policy content as already-active in one atomic step.
--
-- This is not a cross-tenant or role-escalation bug — has_min_role(tenant_id,
-- 'security_admin') correctly scoped it to the caller's own tenant and their
-- own already-elevated role — but it contradicts this project's own stated
-- design for policies (see the Part 2B.2 report and the policies page's own
-- copy): "activation stays read-only pending a future lifecycle RPC" because
-- none exists yet. The UI already never offers an activate action; the
-- database should hold the same line independently, the same way every other
-- write boundary in this schema is enforced at more than one layer.
--
-- Fix: WITH CHECK now also requires the new row to still be 'draft', so a
-- direct client UPDATE can only edit a draft in place, never move it to
-- 'active'. Activating a policy has no supported path in this phase — same
-- as before, just enforced at the layer that was actually missing it.

drop policy "policies_update_drafts_by_security_admin_and_above" on public.policies;

create policy "policies_update_drafts_by_security_admin_and_above"
  on public.policies for update to authenticated
  using (authz.has_min_role(tenant_id, 'security_admin') and status = 'draft')
  with check (authz.has_min_role(tenant_id, 'security_admin') and status = 'draft');
