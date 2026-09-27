import { describe, expect, it } from "vitest";

import { createGithubClient } from "@/lib/github/client";
import { liveConfig } from "@/lib/github/config";
import { EXPECTED_PERMISSIONS } from "@/lib/github/constants";
import { OPERATIONS, type ExecutionContext } from "@/lib/github/operations";
import { parseRepositoryFullName, taskBranchPrefix } from "@/lib/github/validation";

/**
 * Live smoke test: the connector's real operations against the real GitHub API, on ONE test
 * repository you name explicitly. Required environment (see docs/github/LIVE_SMOKE_TEST.md):
 *
 *   GITHUB_EXECUTION_MODE=live  + the App variables (GITHUB_APP_ID, GITHUB_APP_CLIENT_ID,
 *   GITHUB_APP_SLUG, GITHUB_APP_CLIENT_SECRET, GITHUB_WEBHOOK_SECRET, GITHUB_APP_PRIVATE_KEY_FILE,
 *   AUTHORITY_PUBLIC_URL)
 *   GITHUB_LIVE_SMOKE=1
 *   GITHUB_SMOKE_INSTALLATION_ID=<installation id>
 *   GITHUB_SMOKE_REPO=<owner/name of a THROWAWAY test repository>
 *   GITHUB_SMOKE_CONFIRM=I-UNDERSTAND-THIS-WRITES-TO-<owner/name>
 *
 * It never uses the database and never touches the default branch. It creates one branch under
 * authority/<task>/, one file, one draft pull request, reads them back, then closes the PR and
 * deletes its own branch (cleanup uses the App's own permissions, outside the connector).
 */
const repoName = process.env.GITHUB_SMOKE_REPO ?? "";
const armed =
  process.env.GITHUB_LIVE_SMOKE === "1" &&
  process.env.GITHUB_EXECUTION_MODE === "live" &&
  Boolean(process.env.GITHUB_SMOKE_INSTALLATION_ID) &&
  process.env.GITHUB_SMOKE_CONFIRM === `I-UNDERSTAND-THIS-WRITES-TO-${repoName}` &&
  parseRepositoryFullName(repoName).ok;

describe.skipIf(!armed)("live GitHub smoke test (opt-in)", () => {
  const installationId = process.env.GITHUB_SMOKE_INSTALLATION_ID ?? "";
  const taskId = crypto.randomUUID();
  const parsed = parseRepositoryFullName(repoName);
  const { owner, name } = parsed.ok ? parsed.value : { owner: "", name: "" };
  const branch = `${taskBranchPrefix(taskId)}smoke-${Date.now().toString(36)}`;
  let defaultBranch = "main";
  let pullNumber = 0;

  const run = async (tool: string, args: Record<string, unknown>) => {
    const spec = OPERATIONS.get(tool)!;
    const client = createGithubClient();
    const token = await client.mintInstallationToken(installationId, name, spec.permissions);
    const ctx: ExecutionContext = {
      client,
      token,
      owner,
      repo: name,
      taskId,
      signal: new AbortController().signal,
      beforeWrite: () => undefined,
    };
    const parsedArgs = spec.parse(args);
    spec.precheck(parsedArgs, { taskId, defaultBranch });
    return spec.run(ctx, parsedArgs, defaultBranch);
  };

  it("has the expected least-privilege permissions and nothing extra", async () => {
    const client = createGithubClient();
    const r = await client.request(
      { route: "getInstallation", params: { installationId } },
      client.appAuth(),
    );
    const perms = (r.body as { permissions: Record<string, string> }).permissions;
    expect(perms).toEqual(EXPECTED_PERMISSIONS);
    expect(liveConfig()).not.toBeNull();
  });

  it("reads repository metadata and learns the default branch", async () => {
    const res = await run("github.read_repository", {});
    defaultBranch = String((res.agentPayload as { defaultBranch: string }).defaultBranch);
    expect(defaultBranch).toBeTruthy();
  });

  it("creates a task branch, is idempotent, writes a file and opens a draft PR", async () => {
    const b1 = await run("github.create_branch", { branch });
    expect(b1.category).toBe("succeeded");
    expect((await run("github.create_branch", { branch })).category).toBe("succeeded_noop");

    const file = {
      branch,
      path: `authority-smoke/${Date.now()}.txt`,
      content: "authority live smoke\n",
      message: "authority live smoke test",
    };
    expect((await run("github.put_file", file)).category).toBe("succeeded");
    expect((await run("github.put_file", file)).category).toBe("succeeded_noop");

    const pr = await run("github.create_pull_request", {
      head: branch,
      base: defaultBranch,
      title: "Authority live smoke test (safe to close)",
      body: "Created by the opt-in smoke test.",
      draft: true,
    });
    expect(pr.category).toBe("succeeded");
    pullNumber = Number((pr.agentPayload as { number: number }).number);
    expect(
      (
        await run("github.create_pull_request", {
          head: branch,
          base: defaultBranch,
          title: "x",
          draft: true,
        })
      ).category,
    ).toBe("succeeded_noop");
    const read = await run("github.get_pull_request", { pull_number: pullNumber });
    expect(read.resourceIds.htmlUrl).toMatch(/^https:\/\/github\.com\//);
  });

  it("refuses to write the default branch or escape the namespace", async () => {
    await expect(
      run("github.put_file", { branch: defaultBranch, path: "x.txt", content: "x", message: "m" }),
    ).rejects.toMatchObject({ code: "BRANCH_OUTSIDE_TASK_NAMESPACE" });
    await expect(
      run("github.put_file", { branch, path: "../x.txt", content: "x", message: "m" }),
    ).rejects.toMatchObject({ code: "PATH_TRAVERSAL" });
  });

  it("cleans up its own pull request and branch", async () => {
    const client = createGithubClient();
    const token = await client.mintInstallationToken(installationId, name, {
      contents: "write",
      pull_requests: "write",
      metadata: "read",
    });
    // Cleanup is intentionally NOT a connector capability; this script owns the branch it created.
    const auth = client.installationAuth(token);
    if (pullNumber) {
      await fetch(`https://api.github.com/repos/${owner}/${name}/pulls/${pullNumber}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "authority-live-smoke",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state: "closed" }),
      });
    }
    const del = await fetch(`https://api.github.com/repos/${owner}/${name}/git/refs/heads/${branch}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "authority-live-smoke",
      },
    });
    expect([204, 404, 422]).toContain(del.status);
  });
});
