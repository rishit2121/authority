/**
 * Task-wide budgets (migration 20261027000001): an action's allowance spans every contract version of the task.
 * Pure helpers shared by the gateway (tools manifest) and the dashboard.
 */

/** One action's budget on the task's active contract. */
export interface TaskActionBudget {
  tool: string;
  constraints: ReadonlyArray<unknown>;
  /** Task-wide allowance across contract versions; null when the action has not been used or seeded yet. */
  allowance: number | null;
  taskUsed: number;
  versionMax: number | null;
  versionUsed: number;
}

/** Stable text for a constraint list, independent of key order, so an action can be matched with its budget row. */
export function constraintsKey(constraints: ReadonlyArray<unknown>): string {
  return JSON.stringify(
    constraints
      .map((raw) => {
        const c = (raw ?? {}) as { key?: unknown; equals?: unknown; matches?: unknown };
        return [String(c.key ?? ""), c.equals ?? null, c.matches ?? null];
      })
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

/** Remaining invocations: the lower of the version's own remainder and the task-wide remainder, never negative. */
export function remainingInvocations(budget: TaskActionBudget): number | null {
  if (budget.versionMax === null) return null;
  const versionRemaining = budget.versionMax - budget.versionUsed;
  const taskRemaining = (budget.allowance ?? budget.versionMax) - budget.taskUsed;
  return Math.max(0, Math.min(versionRemaining, taskRemaining));
}
