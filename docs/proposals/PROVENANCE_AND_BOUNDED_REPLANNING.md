# Proposal: receipt-derived values and bounded replanning

Status: **proposal, not implemented.** Written during the open-source readiness pass. Nothing here changes current
behavior; see [../LIMITATIONS.md](../LIMITATIONS.md) for what holds today.

## 1. Problem

Two things agents legitimately need are unsafe or impossible today:

1. **Values that come from an earlier result.** "Reply to the sender of message X." Today a recipient must be pinned
   in the plan, so the sender must be known in advance. Allowing the plan to say "the sender comes from step 1" was
   unsafe: nothing checked that the value at call time came from step 1, so it was effectively any value (fixed by
   restricting data flow to free text).
2. **Adapting mid-task without widening authority.** Today a different recipient or a higher amount needs a new
   plan from the trusted backend. (Re-preparing no longer resets an action's budget: task-wide budgets per action
   are built, migration 20261027000001.)

## 2. Receipt-derived values (provenance)

Idea: when Authority itself executes a read, it can bind specific fields of the result to an **opaque handle** that
only it can resolve. A later step refers to the handle, never to a raw value.

- **Declared outputs with schemas.** Registry operations declare typed outputs (e.g. `gmail.get_message` →
  `sender: email address`). A plan step may bind `to` to `step1.sender` only if the output's type matches the field.
- **Handles from receipts.** When the read executes, the executor stores the declared output values in the receipt
  and returns handles (`h_…`) for them, scoped to the task, the contract version and the receipt.
- **Resolution at authorization.** The agent passes the handle as the argument value. `/authorize` resolves it
  inside the database transaction: the handle must belong to this task and contract, come from a succeeded receipt of
  the referenced step, and match the declared output. The capability is bound to the resolved value; the agent never
  supplies the recipient itself.
- **What it does not do.** It does not make the source content trustworthy: a malicious email's sender is still the
  sender. It proves only that the value is the one step 1 returned. Combine with policy (allowed domains) where the
  source is untrusted.

This follows the direction of CaMeL (Debenedetti et al., 2025: trusted control flow, capability-tagged data), which
reports utility costs under its own assumptions; those numbers do not transfer to Authority.

## 3. Bounded replanning

Idea: a **trusted envelope** set by the backend or a person, inside which an agent can obtain **child authorizations**
without a new plan, plus **cumulative task budgets** that no new contract version can reset. (Built for invocation
counts per action: `task_action_allowances`. Cumulative numeric sums, such as a refund total, are not built.)

- **Envelope.** Typed limits per operation, e.g. "refunds only for this customer's payments, total at most $20, no
  email", or "messages only to channels in this list". Expressed as constraint sets the evaluator already understands
  (`equals`, plus a new allowlist form) and cumulative sums for numeric fields.
- **Child authorizations.** The agent proposes a new step; Authority compiles it as usual and accepts it only if it
  is inside the envelope, under the remaining task-wide budgets, and through any required approval or alignment
  check. Anything outside the envelope (a new recipient, a higher total) needs explicit widening by the backend or a
  person, recorded as such.
- **Cumulative budgets.** A task-level ledger (calls per operation, sums per numeric field) carried across contract
  versions, checked in the same transaction as the per-version budget.

## 4. Implementation sketch

1. Registry: declared, typed outputs per operation (`outputFields`).
2. Executor: persist declared outputs in receipts; mint handles (`receipt_outputs` table, task- and contract-scoped,
   append-only, explicit grants).
3. Compiler: a data-flow binding to a non-free-text field compiles to a `fromReceipt` constraint (step, output);
   reject if the output type does not match.
4. Evaluator: resolve handles under the task lock; bind the capability to the resolved value.
5. Envelopes and the task ledger: new contract fields and a `task_budget_ledger` table; evaluator checks.
6. API: handles in `/execute` responses; `excludedSteps` explains when a binding is not provable.

Each step ships with pgTAP suites on the throwaway database (forged, cross-task and stale handles; envelope edge
cases; ledger across versions) and mutation tests on the compiler.

## 5. Open questions

- Handle lifetime and revocation when a contract is superseded.
- How much of an envelope can be stated by a non-technical administrator.
- Whether models drafting plans can be trusted to bind outputs correctly (they need not be: an incorrect binding is
  refused, not widened).
