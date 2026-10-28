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

## Agent-written text

A plan step can list `agentGenerated`: free-text fields that the agent writes at run time, such as Slack `text`, an
email `subject` or an issue `title`. Before this, a required text field could only be left open through a
`dataFlowRefs` reference to a stand-in earlier step. `agentGenerated` states the intent directly, needs no extra
step, and is recorded in the contract per action as `generatedArguments`. That keeps written content distinct from
values derived from earlier steps, and alignment review labels it as agent-written.

- Only free-text fields qualify. A recipient, channel, id, path, branch or amount listed there excludes the step
  (`replan`), as does a field the step also pins or takes from an earlier step.
- The text is open: Authority does not check what it says.

## MCP refuses extra arguments, like REST

MCP `tools/call` used to drop argument keys a tool doesn't declare, then run the call without them. Those keys now
reach authorization, which refuses them with `CONSTRAINT_VIOLATION`, as `/authorize` does.

### Upgrading

1. **Apply migration `20261027000001`, then deploy.** `/ready` reports `mismatch` until both are done. The rollback
   script is `supabase/rollback/20261027_rollback_to_20261023000003.sql`. It has been tested: rollback, the previous
   suites, then re-apply.
2. **Active tasks keep exactly their remaining budget.** A task whose contract had expired starts its next version
   with earlier use counted. Pass `raiseBudgets: true` when you mean to reset it.
3. **`remainingInvocations` can be lower** than `maxInvocations`.
4. **After a re-prepare, agents need a new task session.** The old one gets `409 SESSION_CONTRACT_STALE`. This is
   unchanged, but replanning agents now hit it more often.
5. **Apply migration `20261028000001` (agent-written text), then deploy.** The rollback script is
   `supabase/rollback/20261028_rollback_to_20261027000001.sql`.
6. **The compiler version is now `authority-compiler-2026-10-28-10`.** Active contracts compiled earlier get
   `UNSUPPORTED_CONTRACT_VERSION` until re-prepared. Task-wide budgets carry over, so re-preparing doesn't reset them.
7. **MCP clients that sent extra argument keys** now get a refusal instead of a silently trimmed call.
