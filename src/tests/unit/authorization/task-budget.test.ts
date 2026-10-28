import { describe, expect, it } from "vitest";

import { constraintsKey, remainingInvocations, type TaskActionBudget } from "@/lib/authorization/task-budget";

describe("constraintsKey", () => {
  it("matches the same constraints whatever the key order of each object or of the list", () => {
    const fromContract = [
      { key: "to", equals: "alice@example.com" },
      { key: "channel", equals: "C-ops" },
    ];
    // jsonb returns object keys in its own order; the list order can differ too.
    const fromDatabase = [
      { equals: "C-ops", key: "channel" },
      { equals: "alice@example.com", key: "to" },
    ];
    expect(constraintsKey(fromContract)).toBe(constraintsKey(fromDatabase));
  });

  it("distinguishes different pinned values, keys and constraint kinds", () => {
    const base = constraintsKey([{ key: "channel", equals: "C-ops" }]);
    expect(constraintsKey([{ key: "channel", equals: "C-eng" }])).not.toBe(base);
    expect(constraintsKey([{ key: "chan", equals: "C-ops" }])).not.toBe(base);
    expect(constraintsKey([{ key: "channel", matches: "C-ops" }])).not.toBe(base);
    expect(constraintsKey([])).not.toBe(base);
  });
});

describe("remainingInvocations", () => {
  const budget = (b: Partial<TaskActionBudget>): TaskActionBudget => ({
    tool: "slack.post_message",
    constraints: [],
    allowance: 2,
    taskUsed: 0,
    versionMax: 2,
    versionUsed: 0,
    ...b,
  });

  it("is the version's remainder when the task-wide allowance is not binding", () => {
    expect(remainingInvocations(budget({ allowance: 10, taskUsed: 1, versionUsed: 1 }))).toBe(1);
  });

  it("is the task-wide remainder when earlier versions used the budget", () => {
    // A re-prepared version (nothing used under it yet) inherits what earlier versions spent.
    expect(remainingInvocations(budget({ allowance: 2, taskUsed: 2, versionUsed: 0 }))).toBe(0);
    expect(remainingInvocations(budget({ allowance: 3, taskUsed: 2, versionMax: 5, versionUsed: 0 }))).toBe(
      1,
    );
  });

  it("falls back to the version's limit before the allowance exists, and is never negative", () => {
    expect(remainingInvocations(budget({ allowance: null, taskUsed: 1, versionUsed: 1 }))).toBe(1);
    expect(remainingInvocations(budget({ allowance: 1, taskUsed: 3, versionUsed: 0 }))).toBe(0);
  });

  it("is unknown without a version limit", () => {
    expect(remainingInvocations(budget({ versionMax: null }))).toBeNull();
  });
});
