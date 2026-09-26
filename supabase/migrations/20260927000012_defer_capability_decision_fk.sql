-- Part 4 corrective: authorize_tool_call() needs to insert a capability
-- row whose authorization_decision_id names the decision that is issuing
-- it, before that decision row exists — both are created in the same
-- transaction, and authorization_decisions is append-only (no UPDATE is
-- possible afterward to backfill either side, see 20260927000011), so the
-- capability's id is pre-generated and used by both inserts. That forward
-- reference only works if this foreign key's check is deferred to commit
-- time, by which point both rows exist. Every existing caller of this
-- table (only the demo installer, today) already inserts a capability
-- after its referenced decision exists, so deferring the check changes
-- nothing observable for them — it only ever matters when the check would
-- otherwise fail immediately and now does not fail until commit, which
-- cannot happen for a row that is going to be valid by commit anyway.
alter table public.capabilities
  drop constraint capabilities_authorization_decision_id_tenant_id_fkey,
  add constraint capabilities_authorization_decision_id_tenant_id_fkey
    foreign key (authorization_decision_id, tenant_id) references public.authorization_decisions (id, tenant_id)
    deferrable initially deferred;
