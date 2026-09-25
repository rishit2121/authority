-- Part 3B: a third policy effect, "require_approval", distinct from "deny".
--
-- A "deny" match removes an operation from the plan entirely (unchanged —
-- see plan-validator.ts's evaluateActivePolicies). A "require_approval"
-- match never touches plan validation at all; it is read only by
-- src/lib/authorization/approval-rules.ts's deterministic deriver, which
-- turns a match into a mandatory activation-time approval requirement.

alter type public.policy_effect add value 'require_approval';
