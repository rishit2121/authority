-- Regression for a real bug found during security review and fixed in
-- 20260924000007_restrict_policy_activation.sql: the UPDATE policy on
-- `policies` constrained the caller's role in WITH CHECK but not the
-- resulting `status`, so a security_admin could activate a draft policy —
-- and simultaneously rewrite any other field — via a single direct client
-- UPDATE, with no dedicated validation or audit path. The immutability
-- trigger only blocks a row once it is *already* active; nothing blocked
-- the transition into 'active' itself. Not a cross-tenant or role-
-- escalation bug — has_min_role scoped it correctly to the caller's own
-- tenant and already-elevated role — but it contradicted this project's own
-- stated design that policy activation has no supported client path yet.

select plan(4);

insert into public.policies (id, tenant_id, name, effect, status)
values (
  'f1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
  'AUDIT draft policy', 'deny', 'draft'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
-- owner.a: security_admin-and-above satisfied, real member of tenant A.

-- The regression: activating a draft directly, with no lifecycle RPC.
select t(throws_ok(
  $$ update public.policies set status = 'active', activated_at = now()
     where id = 'f1000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'a security_admin cannot activate a draft policy via a direct client UPDATE'));

reset role;
select t(is(
  (select status::text from public.policies where id = 'f1000000-0000-4000-8000-000000000001'),
  'draft',
  'the fixture policy is unaffected by the rejected activation attempt'));
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- A legitimate draft-to-draft edit must still work — the fix narrows the
-- transition, not ordinary draft editing.
select t(lives_ok(
  $$ update public.policies set description = 'AUDIT edited while still draft'
     where id = 'f1000000-0000-4000-8000-000000000001' $$,
  'a security_admin can still edit a draft policy while it remains draft'));

reset role;
select t(is(
  (select description from public.policies where id = 'f1000000-0000-4000-8000-000000000001'),
  'AUDIT edited while still draft',
  'the draft edit was actually applied'));
