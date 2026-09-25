-- Part 3A: widen contract_status for the Task Authority Contract lifecycle.
--
-- Adds the five new lifecycle states this phase's design requires:
--
--   draft -> proposed
--   proposed -> awaiting_approval | rejected
--   awaiting_approval -> rejected
--   active -> expired | revoked | superseded   (structurally representable;
--                                                 no Part 3A RPC reaches these)
--
-- No transition in this migration, or any Part 3A RPC, ever enters `active`.
-- Existing demo rows (all `active`, verified live before drafting this
-- migration: 4/4 task_authority_contracts rows, 100% demo_key not null)
-- reached that status only via install_demo_workspace()'s direct INSERT —
-- confirmed live that `authenticated` holds zero write grant of any kind on
-- task_authority_contracts, so no raw-client path to `active` exists today
-- and this migration does not add one.
--
-- PostgreSQL 17.6 (verified live on the linked project) permits using a
-- newly added enum value within the same transaction that added it — the
-- historical restriction was removed in PG12. Kept in its own migration file
-- regardless, as a matter of discipline: no later migration in this same
-- deploy ever needs to use these values in the same transaction as this one.

alter type public.contract_status add value 'proposed';
alter type public.contract_status add value 'awaiting_approval';
alter type public.contract_status add value 'rejected';
alter type public.contract_status add value 'expired';
alter type public.contract_status add value 'revoked';
