# Authority v0.3 (in progress, experimental)

## Task-wide budgets

Re-preparing a task used to create a contract version whose budgets started at zero. Repeated replanning could
therefore exceed what the task was meant to allow. Now an action's budget spans every contract version of the
task. An action is a tool with its exact pinned values.

- **The allowance is set when the action first appears.** Re-preparing inherits it. A new version with a higher
  `maxInvocations` is still capped. The denial is `INVOCATION_LIMIT_REACHED`, with the detail "task-wide budget is
  exhausted".
- **Only an explicit raise increases it.**
  - The trusted backend prepares with `raiseBudgets: true`. The outcome reports
    `budgets: "inherited" | "raised" | "raise_on_activation"`.
  - An admin or owner renews from the task page in the dashboard.
  - Runtime keys and task sessions cannot raise budgets.
  - Every seed and raise is recorded in `task_budget_changes`.
- **`GET /tasks/{taskId}/tools`** gives each action `remainingInvocations`: the lower of the version's and the
  task's remainder.

Limits:

- A step with a different pinned value is a different action, with its own budget.
- The contract-wide total (`maxToolInvocations`) is still per version.
- Renewing raises the allowance, not a contract's own limits. A contract that has spent them needs a re-prepare.

### Upgrading

1. **Apply migration `20261027000001`, then deploy.** `/ready` reports `mismatch` until both are done. The rollback
   script is `supabase/rollback/20261027_rollback_to_20261023000003.sql`. It has been tested: rollback, the previous
   suites, then re-apply.
2. **Active tasks keep exactly their remaining budget.** A task whose contract had expired starts its next version
   with earlier use counted. Pass `raiseBudgets: true` when you mean to reset it.
3. **`remainingInvocations` can be lower** than `maxInvocations`.
4. **After a re-prepare, agents need a new task session.** The old one gets `409 SESSION_CONTRACT_STALE`. This is
   unchanged, but replanning agents now hit it more often.
