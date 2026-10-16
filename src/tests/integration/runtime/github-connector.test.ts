import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashCapabilityToken } from "@/lib/gateway/capability-token";
import { closeGatewayPool } from "@/lib/gateway/db";
import { authorizeThroughGateway } from "@/lib/gateway/pipeline";
import { markDispatched, reconcileExpiredReservations, reserveExecution } from "@/lib/gateway/rpc-github";
import { GithubClient } from "@/lib/github/client";
import { defaultExecutorDeps, executeGithubOperation, type ExecuteResult } from "@/lib/github/executor";
import { mockGithub } from "@/lib/github/mock";

import {
  createGatewayFixture,
  currentVersions,
  resetSemanticSettings,
  type GatewayFixture,
  purgeGithubState,
} from "../gateway-support";
import { managementQuery } from "../support";

/**
 * The real connector against the real database, with GitHub replaced by the
 * in-memory mock. Nothing here touches the network or a real credential.
 */

const ACTIONS = JSON.stringify({
  schemaVersion: 1,
  items: [
    "github.get_issue",
    "github.read_repository",
    "github.create_branch",
    "github.put_file",
    "github.create_pull_request",
    "github.get_pull_request",
  ].map((tool) => ({ tool, constraints: [] })),
});

interface Ctx {
  fx: GatewayFixture;
  repo: string;
}

let seq = 0;
const key = (p: string) => `${p}-${Date.now()}-${++seq}`;

async function authorize(c: Ctx, tool: string, args: Record<string, string | number | boolean>, maxUses = 1) {
  const r = await authorizeThroughGateway({
    credentialSecret: c.fx.secret,
    taskId: c.fx.taskId,
    tool,
    operation: tool.split(".")[1],
    resource: c.repo,
    arguments: args,
    idempotencyKey: key("auth"),
    maxUses,
    ...currentVersions(),
  });
  if (r.kind !== "decision" || !r.capabilityToken) {
    throw new Error(
      `no capability for ${tool}: ${JSON.stringify(r.kind === "decision" ? r.commit.reasonCodes : r.kind === "failure" ? r.status : r.outcome)}`,
    );
  }
  return r.capabilityToken;
}

function run(
  c: Ctx,
  token: string,
  tool: string,
  args: Record<string, string | number | boolean>,
  idem = key("exec"),
  deps = defaultExecutorDeps,
): Promise<ExecuteResult> {
  return executeGithubOperation(
    {
      credentialSecret: c.fx.secret,
      tokenHash: hashCapabilityToken(token),
      tool,
      operation: tool.split(".")[1],
      resource: c.repo,
      args,
      idempotencyKey: idem,
    },
    deps,
  );
}

async function once(c: Ctx, tool: string, args: Record<string, string | number | boolean>) {
  return run(c, await authorize(c, tool, args), tool, args);
}

const prefix = (fx: GatewayFixture) => `authority/${fx.taskId.replace(/-/g, "").slice(0, 8)}/`;

async function tokenRow(token: string) {
  const [row] = (await managementQuery(
    `select uses, reserved_uses, status, budget_released_uses from public.capability_tokens where token_hash = '${hashCapabilityToken(token)}';`,
  )) as Array<{ uses: number; reserved_uses: number; status: string; budget_released_uses: number }>;
  return row;
}

describe("GitHub connector (mock GitHub, real database)", () => {
  let main: Ctx;
  const fixtures: GatewayFixture[] = [];
  const mk = async (label: string, repo: string): Promise<Ctx> => {
    const fx = await createGatewayFixture({
      label,
      actions: ACTIONS,
      maxToolInvocations: 100,
      useCurrentVersions: true,
      githubRepo: repo,
    });
    fixtures.push(fx);
    return { fx, repo };
  };

  beforeAll(async () => {
    process.env.GITHUB_EXECUTION_MODE = "mock";
    await resetSemanticSettings();
    main = await mk("gh-main", "acme/widgets");
  }, 60_000);

  beforeEach(() => mockGithub().log.splice(0));

  afterAll(async () => {
    for (const f of fixtures) await f.cleanup();
    await purgeGithubState();
    await closeGatewayPool();
  }, 60_000);

  it("reads an issue, consumes the capability and records a compact receipt without the response body", async () => {
    const token = await authorize(main, "github.get_issue", { issue_number: "1" });
    const res = await run(main, token, "github.get_issue", { issue_number: "1" });
    expect(res.http).toBe(200);
    expect(res.body).toMatchObject({ result: "succeeded", execution: { mode: "mock", simulated: true } });
    expect((res.body.data as { title: string }).title).toBe("Fix login bug");

    expect(await tokenRow(token)).toMatchObject({ uses: 1, reserved_uses: 0, status: "consumed" });
    const [receipt] = (await managementQuery(
      `select * from public.github_execution_receipts where execution_id = '${res.body.executionId}';`,
    )) as Array<Record<string, unknown>>;
    expect(receipt).toMatchObject({
      result_category: "succeeded",
      execution_mode: "mock",
      tool: "github.get_issue",
      repository_full_name: "acme/widgets",
      http_status_class: 2,
    });
    expect(receipt.github_request_id).toMatch(/^MOCK-/);
    // Evidence, not content: nothing of the issue text is stored anywhere in the receipt.
    expect(JSON.stringify(receipt)).not.toContain("plus sign");
    expect(JSON.stringify(receipt)).not.toContain("Fix login bug");
  });

  it("mints one repository-scoped, permission-minimal installation token per execution and never uses the app credential on the repo", async () => {
    mockGithub().tokens.clear();
    await once(main, "github.get_issue", { issue_number: "1" });
    const tokens = [...mockGithub().tokens.values()];
    expect(tokens).toHaveLength(1);
    expect(tokens[0].repoNames).toEqual(["widgets"]);
    expect(tokens[0].permissions).toEqual({ issues: "read", metadata: "read" });
    const repoCalls = mockGithub().log.filter((l) => l.repo);
    expect(repoCalls.every((l) => l.authKind === "installation_token")).toBe(true);
  });

  it("runs the whole workflow: branch, file, pull request, read-back — and each step is idempotent", async () => {
    const branch = `${prefix(main.fx)}fix-login`;
    const b1 = await once(main, "github.create_branch", { branch });
    expect(b1.body).toMatchObject({ result: "succeeded" });
    const b2 = await once(main, "github.create_branch", { branch });
    expect(b2.body).toMatchObject({ result: "succeeded_noop" });

    const file = { branch, path: "src/login.txt", content: "fixed\n", message: "Fix login" };
    const f1 = await once(main, "github.put_file", file);
    expect(f1.body).toMatchObject({ result: "succeeded" });
    const f2 = await once(main, "github.put_file", file);
    expect(f2.body).toMatchObject({ result: "succeeded_noop" });

    const pr = { head: branch, base: "main", title: "Fix login", body: "Fixes #1" };
    const p1 = await once(main, "github.create_pull_request", pr);
    expect(p1.body).toMatchObject({ result: "succeeded" });
    const number = (p1.body.data as { number: number }).number;
    const p2 = await once(main, "github.create_pull_request", pr);
    expect(p2.body).toMatchObject({ result: "succeeded_noop" });
    expect((p2.body.data as { number: number }).number).toBe(number);
    expect(mockGithub().log.filter((l) => l.route === "createPull")).toHaveLength(1);

    const g = await once(main, "github.get_pull_request", { pull_number: number });
    expect(g.body).toMatchObject({ result: "succeeded" });
    expect((g.body.resource as { htmlUrl: string }).htmlUrl).toMatch(
      /^https:\/\/github\.com\/acme\/widgets\/pull\/\d+$/,
    );
  });

  it("rejects branches outside the task namespace, the default branch, and traversal paths BEFORE dispatch (use refunded)", async () => {
    const cases: Array<[string, Record<string, string>, string]> = [
      ["github.create_branch", { branch: "main" }, "BRANCH_OUTSIDE_TASK_NAMESPACE"],
      ["github.create_branch", { branch: "authority/00000000/other" }, "BRANCH_OUTSIDE_TASK_NAMESPACE"],
      ["github.create_branch", { branch: `${prefix(main.fx)}../escape` }, "BRANCH_INVALID"],
      [
        "github.put_file",
        { branch: `${prefix(main.fx)}x`, path: "../secrets.txt", content: "x", message: "m" },
        "PATH_TRAVERSAL",
      ],
      [
        "github.put_file",
        { branch: `${prefix(main.fx)}x`, path: "a/%2e%2e/b", content: "x", message: "m" },
        "PATH_AMBIGUOUS",
      ],
      [
        "github.put_file",
        { branch: `${prefix(main.fx)}x`, path: ".github/workflows/ci.yml", content: "x", message: "m" },
        "PATH_FORBIDDEN",
      ],
      [
        "github.create_pull_request",
        { head: `${prefix(main.fx)}x`, base: "develop", title: "t" },
        "PR_BASE_NOT_ALLOWED",
      ],
    ];
    for (const [tool, args, code] of cases) {
      const token = await authorize(main, tool, args);
      const res = await run(main, token, tool, args);
      expect(res.body.error, `${tool} ${JSON.stringify(args)}`).toMatchObject({ code });
      expect(res.body.status).toBe("released");
      // The reservation was released, so the use is back and nothing was sent to GitHub.
      expect(await tokenRow(token)).toMatchObject({ uses: 0, reserved_uses: 0 });
    }
    expect(mockGithub().log.filter((l) => l.mutating)).toHaveLength(0);
  });

  it("refuses an unknown argument (no way to smuggle a URL, path or method)", async () => {
    const args = { issue_number: "1", url: "https://evil.example/x" };
    const token = await authorize(main, "github.get_issue", args);
    const res = await run(main, token, "github.get_issue", args);
    expect(res.body.error).toMatchObject({ code: "ARGUMENTS_INVALID" });
    expect(mockGithub().log).toHaveLength(0);
  });

  it("detects a SHA mismatch and requires the expected blob sha to update an existing file", async () => {
    const branch = `${prefix(main.fx)}sha-check`;
    await once(main, "github.create_branch", { branch });
    const base = { branch, path: "notes.txt", message: "notes" };
    await once(main, "github.put_file", { ...base, content: "v1" });
    const noSha = await once(main, "github.put_file", { ...base, content: "v2" });
    expect(noSha.body.error).toMatchObject({ code: "EXPECTED_SHA_REQUIRED" });
    const wrong = await once(main, "github.put_file", {
      ...base,
      content: "v2",
      expected_sha: "0".repeat(40),
    });
    expect(wrong.body.error).toMatchObject({ code: "SHA_MISMATCH" });
    expect(wrong.body.status).toBe("failed");
  });

  it("rejects a base SHA that is not the branch head", async () => {
    const branch = `${prefix(main.fx)}base-sha`;
    const res = await once(main, "github.create_branch", { branch, base_sha: "1".repeat(40) });
    expect(res.body.error).toMatchObject({ code: "BASE_SHA_MISMATCH" });
    expect(mockGithub().log.filter((l) => l.mutating)).toHaveLength(0);
  });

  it("never reserves a repository that is not allowlisted, not bound, or not the capability's resource", async () => {
    // acme/unlisted exists in the mock installation's world but was never allowed for this task.
    const c: Ctx = { fx: main.fx, repo: "acme/unlisted" };
    const token = await authorize(c, "github.get_issue", { issue_number: "1" });
    const res = await run(c, token, "github.get_issue", { issue_number: "1" });
    expect(res.http).toBe(403);
    expect(res.body.error).toMatchObject({ code: "REPOSITORY_NOT_BOUND" });
    expect(mockGithub().log).toHaveLength(0);
    expect(await tokenRow(token)).toMatchObject({ uses: 0, reserved_uses: 0 });
  });

  it("replays a finished execution from its idempotency key without re-executing", async () => {
    const args = { issue_number: "1" };
    const token = await authorize(main, "github.get_issue", args);
    const first = await run(main, token, "github.get_issue", args, "fixed-key");
    expect(first.http).toBe(200);
    mockGithub().log.splice(0);
    const again = await run(main, token, "github.get_issue", args, "fixed-key");
    expect(again.body).toMatchObject({
      replayed: true,
      status: "consumed",
      executionId: first.body.executionId,
    });
    expect(mockGithub().log).toHaveLength(0);
    const other = await run(main, token, "github.get_issue", args, "another-key");
    expect(other.body.error).toMatchObject({ code: "CAPABILITY_ALREADY_USED" });
  });

  it("rejects an idempotency key reused with different arguments", async () => {
    const args = { issue_number: "1" };
    const token = await authorize(main, "github.get_issue", args, 2);
    await run(main, token, "github.get_issue", args, "conflict-key");
    const res = await run(main, token, "github.get_issue", args, "conflict-key", {
      ...defaultExecutorDeps,
      reserve: (i) => defaultExecutorDeps.reserve({ ...i, args: { issue_number: "2" } }),
    });
    expect(res.body.error).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("fails closed when the connector is disabled or when mode does not match", async () => {
    const args = { issue_number: "1" };
    const token = await authorize(main, "github.get_issue", args);
    const off = await run(main, token, "github.get_issue", args, key("x"), {
      ...defaultExecutorDeps,
      mode: () => "disabled",
    });
    expect(off.http).toBe(503);
    // A live-mode execution against a mock installation is refused by the database.
    const live = await run(main, token, "github.get_issue", args, key("x"), {
      ...defaultExecutorDeps,
      mode: () => "live",
      ready: () => ({ ready: true, missing: [] }),
    });
    expect(live.body.error).toMatchObject({ code: "EXECUTION_MODE_MISMATCH" });
    expect(await tokenRow(token)).toMatchObject({ uses: 0, reserved_uses: 0 });
  });

  describe("failures after dispatch", () => {
    it("marks a write timeout INDETERMINATE, spends the use and never retries", async () => {
      const c = await mk("gh-timeout", "acme/fault-write-timeout");
      const branch = `${prefix(c.fx)}t1`;
      const token = await authorize(c, "github.create_branch", { branch });
      const res = await run(c, token, "github.create_branch", { branch }, "timeout-key");
      expect(res.http).toBe(504);
      expect(res.body).toMatchObject({ status: "indeterminate", error: { code: "EXECUTION_INDETERMINATE" } });
      expect(mockGithub().log.filter((l) => l.mutating)).toHaveLength(1);
      expect(await tokenRow(token)).toMatchObject({ uses: 1, reserved_uses: 0, status: "consumed" });

      mockGithub().log.splice(0);
      const again = await run(c, token, "github.create_branch", { branch }, "timeout-key");
      expect(again.body).toMatchObject({ replayed: true, status: "indeterminate" });
      expect(mockGithub().log).toHaveLength(0);
    });

    it("keeps a 5xx on a write indeterminate but treats a 403 as a definite failure", async () => {
      const c502 = await mk("gh-502", "acme/fault-write-502");
      const r502 = await once(c502, "github.create_branch", { branch: `${prefix(c502.fx)}b` });
      expect(r502.body).toMatchObject({ status: "indeterminate" });
      const c403 = await mk("gh-403", "acme/fault-write-403");
      const r403 = await once(c403, "github.create_branch", { branch: `${prefix(c403.fx)}b` });
      expect(r403.body).toMatchObject({ status: "failed", error: { code: "FORBIDDEN" } });
    });

    it("after a lost response, a fresh capability finds the branch already there and succeeds without a second write", async () => {
      const c = await mk("gh-applied", "acme/fault-write-timeout-applied");
      const branch = `${prefix(c.fx)}applied`;
      const lost = await once(c, "github.create_branch", { branch });
      expect(lost.body).toMatchObject({ status: "indeterminate" });
      mockGithub().log.splice(0);
      const retry = await once(c, "github.create_branch", { branch });
      expect(retry.body).toMatchObject({ result: "succeeded_noop" });
      expect(mockGithub().log.filter((l) => l.mutating)).toHaveLength(0);
    });

    it("fails a read that outlives the whole-operation deadline (definite: nothing was written)", async () => {
      const args = { issue_number: "1" };
      const slow = {
        ...defaultExecutorDeps,
        deadlineMs: 20,
        client: () =>
          new GithubClient(
            {
              send: (req, auth) =>
                new Promise((resolve) => setTimeout(() => resolve(mockGithub().send(req, auth)), 150)),
            },
            () => "mock-app-jwt",
            "mock",
          ),
      };
      const token = await authorize(main, "github.get_issue", args);
      const res = await run(main, token, "github.get_issue", args, key("slow"), slow);
      expect(res.http).toBe(504);
      expect(res.body).toMatchObject({ status: "failed", error: { reason: "DEADLINE_EXCEEDED" } });
      await new Promise((r) => setTimeout(r, 250)); // let the abandoned slow request drain before the next test
    });
  });

  describe("revocation and leases", () => {
    it("re-checks revocation between reservation and dispatch and releases the reservation", async () => {
      const args = { issue_number: "1" };
      const token = await authorize(main, "github.get_issue", args);
      const res = await run(main, token, "github.get_issue", args, key("rev"), {
        ...defaultExecutorDeps,
        dispatch: async (i) => {
          await managementQuery(
            `update public.capability_tokens set status = 'revoked', revoked_at = now(), revoked_by = 'admin', revocation_reason = 'test' where token_hash = '${hashCapabilityToken(token)}';`,
          );
          return markDispatched(i);
        },
      });
      expect(res.http).toBe(403);
      expect(res.body.error).toMatchObject({ code: "CAPABILITY_REVOKED" });
      expect(mockGithub().log.filter((l) => l.repo)).toHaveLength(0);
      const row = await tokenRow(token);
      expect(row).toMatchObject({ uses: 0, reserved_uses: 0, status: "revoked" });
    });

    it("blocks dispatch when the contract, the agent or the installation stops being valid", async () => {
      for (const [label, breakIt, restore] of [
        [
          "agent",
          `update public.agents set status = 'revoked' where id = '${main.fx.agentId}'`,
          `update public.agents set status = 'active' where id = '${main.fx.agentId}'`,
        ],
        [
          "installation",
          `update public.github_installations set status = 'suspended', suspended_at = now() where tenant_id = '${main.fx.tenantId}' and status = 'active'`,
          `update public.github_installations set status = 'active', suspended_at = null where tenant_id = '${main.fx.tenantId}' and status = 'suspended'`,
        ],
      ] as const) {
        const args = { issue_number: "1" };
        const token = await authorize(main, "github.get_issue", args);
        const reserved = await reserveExecution({
          credentialSecret: main.fx.secret,
          tokenHash: hashCapabilityToken(token),
          tool: "github.get_issue",
          operation: "get_issue",
          resource: main.repo,
          args,
          idempotencyKey: key("blk"),
          executionMode: "mock",
          leaseSeconds: 45,
        });
        expect(reserved.result, label).toBe("reserved");
        await managementQuery(breakIt);
        try {
          const d = await markDispatched({ executionId: reserved.executionId!, agentId: main.fx.agentId });
          expect(d.status, label).toBe("blocked");
        } finally {
          await managementQuery(restore);
        }
        expect(await tokenRow(token)).toMatchObject({ uses: 0, reserved_uses: 0 });
      }
    });

    it("reconciles expired leases: undispatched -> released (use refunded), dispatched -> indeterminate (use spent)", async () => {
      const args = { issue_number: "1" };
      const reserveOne = async (token: string) =>
        reserveExecution({
          credentialSecret: main.fx.secret,
          tokenHash: hashCapabilityToken(token),
          tool: "github.get_issue",
          operation: "get_issue",
          resource: main.repo,
          args,
          idempotencyKey: key("lease"),
          executionMode: "mock",
          leaseSeconds: 45,
        });
      const expire = (id: string) =>
        managementQuery(`
          alter table public.capability_reservations disable trigger capability_reservations_guard;
          update public.capability_reservations set reserved_at = now() - interval '3 minutes', lease_expires_at = now() - interval '2 minutes' where id = '${id}';
          alter table public.capability_reservations enable trigger capability_reservations_guard;
        `);

      const t1 = await authorize(main, "github.get_issue", args);
      const r1 = await reserveOne(t1);
      await expire(r1.executionId!);

      const t2 = await authorize(main, "github.get_issue", args);
      const r2 = await reserveOne(t2);
      await markDispatched({ executionId: r2.executionId!, agentId: main.fx.agentId });
      await expire(r2.executionId!);

      expect(await reconcileExpiredReservations(100)).toBeGreaterThanOrEqual(2);
      expect(await tokenRow(t1)).toMatchObject({ uses: 0, reserved_uses: 0 });
      expect(await tokenRow(t2)).toMatchObject({ uses: 1, reserved_uses: 0, status: "consumed" });
      const rows = (await managementQuery(
        `select id, status, reason_code from public.capability_reservations where id in ('${r1.executionId}', '${r2.executionId}');`,
      )) as Array<{ id: string; status: string; reason_code: string }>;
      expect(rows.find((r) => r.id === r1.executionId)).toMatchObject({
        status: "released",
        reason_code: "LEASE_EXPIRED_BEFORE_DISPATCH",
      });
      expect(rows.find((r) => r.id === r2.executionId)).toMatchObject({
        status: "indeterminate",
        reason_code: "LEASE_EXPIRED_AFTER_DISPATCH",
      });
    });
  });

  describe("unused budget", () => {
    it("returns the unused remainder of a revoked capability to the contract budget, exactly once", async () => {
      const c = await mk("gh-budget", "acme/widgets");
      const args = { issue_number: "1" };
      const budgetBefore = async () =>
        (
          (await managementQuery(
            `select consumed_uses from public.capabilities where task_id = '${c.fx.taskId}';`,
          )) as Array<{ consumed_uses: number }>
        )[0]?.consumed_uses;
      const token = await authorize(c, "github.get_issue", args, 3);
      expect(await budgetBefore()).toBe(3);
      const { revokeCapabilityViaGateway } = await import("@/lib/gateway/rpc");
      const [{ id }] = (await managementQuery(
        `select id from public.capability_tokens where token_hash = '${hashCapabilityToken(token)}';`,
      )) as Array<{ id: string }>;
      await revokeCapabilityViaGateway({
        credentialSecret: c.fx.secret,
        capabilityId: id,
        reason: "no longer needed",
      });
      expect(await budgetBefore()).toBe(0);
      expect((await tokenRow(token)).budget_released_uses).toBe(3);
      await revokeCapabilityViaGateway({ credentialSecret: c.fx.secret, capabilityId: id, reason: "again" });
      expect(await budgetBefore()).toBe(0);
    });
  });

  describe("secrets and redaction", () => {
    it("never returns or persists an installation token, and redacts token-shaped text from returned content", async () => {
      const repo = mockGithub().repoByName("acme", "widgets")!;
      repo.issues.set(7, {
        title: "leak",
        body: "here is a token ghp_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6 and more",
        state: "open",
      });
      mockGithub().tokens.clear();
      const res = await once(main, "github.get_issue", { issue_number: "7" });
      const text = JSON.stringify(res);
      expect(text).not.toContain("ghp_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6");
      expect(text).toContain("[REDACTED:github_token]");
      for (const t of mockGithub().tokens.keys()) {
        expect(text).not.toContain(t);
        const hits = (await managementQuery(`
          select count(*)::int as n from (
            select row_to_json(r)::text as t from public.github_execution_receipts r
            union all select row_to_json(r)::text from public.capability_reservations r
            union all select row_to_json(e)::text from public.execution_events e where e.task_id = '${main.fx.taskId}'
            union all select row_to_json(c)::text from public.capability_consumptions c
          ) x where t like '%${t}%' or t like '%ghp_aB3dE6gH9jK2%';
        `)) as Array<{ n: number }>;
        expect(hits[0].n).toBe(0);
      }
    });

    it("keeps receipts immutable", async () => {
      const res = await once(main, "github.get_issue", { issue_number: "1" });
      await expect(
        managementQuery(
          `update public.github_execution_receipts set result_category = 'failed' where execution_id = '${res.body.executionId}';`,
        ),
      ).rejects.toThrow();
      await expect(
        managementQuery(
          `delete from public.github_execution_receipts where execution_id = '${res.body.executionId}';`,
        ),
      ).rejects.toThrow();
    });
  });
});
