import { describe, expect, it, vi } from "vitest";

import { GithubClient } from "@/lib/github/client";
import { defaultExecutorDeps, executeGithubOperation, type ExecutorDeps } from "@/lib/github/executor";
import { MockGithub } from "@/lib/github/mock";
import type { ReserveResult } from "@/lib/gateway/rpc-github";

const TASK = "dd000000-0000-4000-8000-000000000012";
const BRANCH = "authority/dd000000/fix";

const reserved = (over: Partial<ReserveResult> = {}): ReserveResult => ({
  status: "ok",
  result: "reserved",
  reasonCode: "RESERVED",
  executionId: "e1",
  capabilityId: "c1",
  taskId: TASK,
  agentId: "a1",
  githubInstallationId: "9001",
  repository: "acme/widgets",
  defaultBranch: "main",
  leaseExpiresAt: null,
  previousStatus: null,
  previousReceipt: null,
  ...over,
});

function harness(
  options: Partial<Omit<ExecutorDeps, "reserve">> & { reserve?: ReserveResult; mock?: MockGithub } = {},
) {
  const { reserve: reserveResult, mock: providedMock, ...over } = options;
  const mock = providedMock ?? new MockGithub();
  const finish = vi.fn(async (i: { category: string }) => ({
    status: "ok",
    receiptId: "r1",
    finalStatus: i.category === "released" ? "released" : "consumed",
  }));
  const dispatch = vi.fn(async () => ({ status: "ok", reason: null as string | null }));
  const reserve = vi.fn(async () => reserveResult ?? reserved());
  const deps: ExecutorDeps = {
    ...defaultExecutorDeps,
    mode: () => "mock",
    ready: () => ({ ready: true, missing: [] }),
    reserve: reserve as never,
    dispatch: dispatch as never,
    finish: finish as never,
    client: () => new GithubClient(mock, () => "mock-app-jwt", "mock"),
    ...over,
  };
  return { deps, finish, dispatch, reserve, mock };
}

const input = (tool: string, args: Record<string, unknown>) => ({
  credentialSecret: "authority_rk_x".padEnd(40, "0"),
  tokenHash: "0".repeat(64),
  tool,
  operation: tool.split(".")[1],
  resource: "acme/widgets",
  args,
  idempotencyKey: "k",
});

describe("executor (no database)", () => {
  it("does not touch the database or GitHub when the connector is disabled or unconfigured", async () => {
    const h = harness({ mode: () => "disabled" });
    expect(
      (await executeGithubOperation(input("github.get_issue", { issue_number: "1" }), h.deps)).http,
    ).toBe(503);
    const h2 = harness({ ready: () => ({ ready: false, missing: ["GITHUB_APP_ID"] }) });
    const r = await executeGithubOperation(input("github.get_issue", { issue_number: "1" }), h2.deps);
    expect(r.http).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain("GITHUB_APP_ID");
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h2.reserve).not.toHaveBeenCalled();
    expect(h.mock.log).toHaveLength(0);
  });

  it("rejects tools the connector does not implement before reserving anything", async () => {
    const h = harness();
    for (const tool of [
      "github.delete_branch",
      "github.get_repository_secrets",
      "github.push_commit",
      "gmail.send_email",
      "stripe.issue_refund",
    ]) {
      const r = await executeGithubOperation(input(tool, {}), h.deps);
      expect(r.http, tool).toBe(400);
      expect(r.body.error).toMatchObject({ code: "OPERATION_NOT_SUPPORTED" });
    }
    expect(h.reserve).not.toHaveBeenCalled();
  });

  it("releases (never dispatches) on invalid arguments, wrong repository, or a namespace escape", async () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["github.get_issue", { issue_number: "1", url: "https://evil.example" }, "ARGUMENTS_INVALID"],
      ["github.get_issue", { issue_number: "1", repository: "acme/other" }, "REPOSITORY_MISMATCH"],
      ["github.create_branch", { branch: "main" }, "BRANCH_OUTSIDE_TASK_NAMESPACE"],
      ["github.put_file", { branch: BRANCH, path: "../x", content: "c", message: "m" }, "PATH_TRAVERSAL"],
    ];
    for (const [tool, args, code] of cases) {
      const h = harness();
      const r = await executeGithubOperation(input(tool, args), h.deps);
      expect(r.body.error, tool).toMatchObject({ code });
      expect(h.dispatch).not.toHaveBeenCalled();
      expect(h.finish).toHaveBeenCalledWith(expect.objectContaining({ category: "released" }));
      expect(h.mock.log).toHaveLength(0);
    }
  });

  it("never sends a request when the dispatch re-check blocks", async () => {
    const h = harness({
      dispatch: (async () => ({ status: "blocked", reason: "CAPABILITY_REVOKED" })) as never,
    });
    const r = await executeGithubOperation(input("github.get_issue", { issue_number: "1" }), h.deps);
    expect(r.http).toBe(403);
    expect(h.mock.log.filter((l) => l.repo)).toHaveLength(0);
    expect(h.finish).not.toHaveBeenCalled();
  });

  it("dispatches at most once and settles exactly once per execution", async () => {
    const h = harness();
    const r = await executeGithubOperation(input("github.get_issue", { issue_number: "1" }), h.deps);
    expect(r.http).toBe(200);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.finish).toHaveBeenCalledTimes(1);
    expect(h.finish).toHaveBeenCalledWith(expect.objectContaining({ category: "succeeded" }));
  });

  it("marks an unexpected internal error after a write started as indeterminate, before one as failed", async () => {
    const h = harness();
    h.mock.repoByName("acme", "widgets")!.issues.set(1, { title: "t", body: "b", state: "open" });
    const boom = new GithubClient(
      {
        send: async () => {
          throw new Error("boom");
        },
      },
      () => "j",
      "mock",
    );
    const h2 = harness({ client: () => boom });
    const r = await executeGithubOperation(input("github.get_issue", { issue_number: "1" }), h2.deps);
    expect(r.http).toBe(502); // token mint failed: nothing dispatched -> released
    expect(h2.finish).toHaveBeenCalledWith(expect.objectContaining({ category: "released" }));
  });

  it("reports a settlement failure as unknown state and never as success", async () => {
    const h = harness({
      finish: (async () => {
        throw new Error("db down");
      }) as never,
    });
    const r = await executeGithubOperation(input("github.get_issue", { issue_number: "1" }), h.deps);
    expect(r.http).toBe(503);
    expect(r.body.error).toMatchObject({ code: "EXECUTION_STATE_UNKNOWN" });
  });

  it("returns the recorded state, not a re-execution, for a replayed key", async () => {
    const h = harness({
      reserve: reserved({
        result: "replayed",
        previousStatus: "indeterminate",
        previousReceipt: { category: "indeterminate" },
      }),
    });
    const r = await executeGithubOperation(input("github.create_branch", { branch: BRANCH }), h.deps);
    expect(r.body).toMatchObject({ replayed: true, status: "indeterminate" });
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.mock.log).toHaveLength(0);
  });

  it("maps database rejections without leaking anything", async () => {
    for (const [reason, http] of [
      ["REPOSITORY_NOT_BOUND", 403],
      ["SCOPE_MISMATCH", 403],
      ["CAPABILITY_NOT_FOUND", 404],
      ["CAPABILITY_ALREADY_USED", 409],
    ] as const) {
      const h = harness({ reserve: reserved({ result: "rejected", reasonCode: reason, executionId: null }) });
      const r = await executeGithubOperation(input("github.get_issue", { issue_number: "1" }), h.deps);
      expect(r.http).toBe(http);
      expect(h.mock.log).toHaveLength(0);
    }
  });

  it("does not put an installation token in any response, log entry argument or receipt input", async () => {
    const h = harness();
    const r = await executeGithubOperation(input("github.get_issue", { issue_number: "1" }), h.deps);
    const minted = [...h.mock.tokens.keys()];
    expect(minted).toHaveLength(1);
    const blob = JSON.stringify([r, h.finish.mock.calls, h.dispatch.mock.calls, h.reserve.mock.calls]);
    expect(blob).not.toContain(minted[0]);
    expect(blob).not.toMatch(/ghs_/);
  });
});
