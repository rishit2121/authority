import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gateway/db", async () => {
  class GatewayDatabaseError extends Error {
    readonly sqlstate: string;
    constructor(sqlstate: string) {
      super(`gateway database call failed (sqlstate ${sqlstate})`);
      this.sqlstate = sqlstate;
    }
  }
  return { gatewayQuery: vi.fn(), GatewayDatabaseError };
});

import { GatewayDatabaseError, gatewayQuery } from "@/lib/gateway/db";
import { taskActionBudgets } from "@/lib/gateway/rpc";

const query = vi.mocked(gatewayQuery);

describe("taskActionBudgets", () => {
  beforeEach(() => query.mockReset());

  it("maps the gateway rows", async () => {
    query.mockResolvedValueOnce([
      {
        tab_tool: "slack.post_message",
        tab_resource_constraints: { schemaVersion: 1, items: [{ key: "channel", equals: "C-ops" }] },
        tab_allowance: 2,
        tab_task_used: "1",
        tab_version_max: 2,
        tab_version_used: "0",
      },
    ] as never);
    expect(await taskActionBudgets("t")).toEqual([
      {
        tool: "slack.post_message",
        constraints: [{ key: "channel", equals: "C-ops" }],
        allowance: 2,
        taskUsed: 1,
        versionMax: 2,
        versionUsed: 0,
      },
    ]);
  });

  it("is empty on a database that predates the migration (the function does not exist yet)", async () => {
    query.mockRejectedValueOnce(new GatewayDatabaseError("42883"));
    expect(await taskActionBudgets("t")).toEqual([]);
  });

  it("still fails on any other database error", async () => {
    query.mockRejectedValueOnce(new GatewayDatabaseError("57014"));
    await expect(taskActionBudgets("t")).rejects.toBeInstanceOf(GatewayDatabaseError);
  });
});
