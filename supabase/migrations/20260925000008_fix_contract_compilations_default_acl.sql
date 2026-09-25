-- Corrective: contract_compilations was created without first revoking
-- Supabase's default ACL from `authenticated` before granting SELECT back —
-- the exact Finding-1 bug class from the earlier security review
-- (over-broad default-privilege grants on a newly created table), caught
-- this time by 07_schema_inventory.sql's dynamic check ("every authenticated
-- INSERT/UPDATE/DELETE grant is backed by a matching policy") the moment
-- the pgTAP suite ran against the real deployed schema.
--
-- Verified live before writing this fix: `authenticated` held
-- DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE on
-- contract_compilations — the full default set, not just the intended
-- SELECT. Not exploitable in practice (RLS has no INSERT/UPDATE/DELETE
-- policy on this table, so those operations are independently denied by
-- default-deny regardless of the grant, and the append-only trigger blocks
-- UPDATE/DELETE for every role including postgres), but the grant layer
-- should reflect intent on its own rather than depending on RLS or a
-- trigger to cover a privilege-layer mistake — the same reasoning as the
-- original Finding 1.

revoke all on table public.contract_compilations from authenticated;
grant select on table public.contract_compilations to authenticated;
