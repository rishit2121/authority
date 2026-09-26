import { createHash, randomUUID } from "node:crypto";

import { EXPECTED_PERMISSIONS } from "./constants";
import { TransportError } from "./errors";
import type { RouteRequest } from "./routes";
import type { GithubAuth, GithubHttpResponse, GithubTransport } from "./transport";

/**
 * An in-memory GitHub used for development and every mocked test. It enforces
 * the same properties the real API does that the connector relies on:
 * installation tokens are scoped to the repositories and permissions they were
 * minted for, refs/files/PRs behave like GitHub's, and writes can be made to
 * fail in the ways that matter (timeouts, applied-then-lost, 5xx, 403).
 *
 * Failure behavior is selected by REPOSITORY NAME so it works across the
 * separate server process an end-to-end test drives:
 *   fault-write-timeout          write never applied, connection times out
 *   fault-write-timeout-applied  write applied, response lost (times out)
 *   fault-write-502              write not applied, GitHub returns 502
 *   fault-write-403              write refused with 403
 */

const sha = (seed: string) => createHash("sha1").update(seed).digest("hex");

interface MockFile {
  sha: string;
  content: string; // base64
}
interface MockPull {
  number: number;
  title: string;
  state: "open" | "closed";
  head: string;
  base: string;
  headSha: string;
  draft: boolean;
}
export interface MockRepo {
  id: number;
  owner: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  branches: Map<string, string>;
  protectedBranches: Set<string>;
  files: Map<string, MockFile>; // `${branch}\0${path}`
  issues: Map<number, { title: string; body: string; state: string }>;
  pulls: MockPull[];
}
export interface MockInstallation {
  id: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  accountId: number;
  selection: "all" | "selected";
  permissions: Record<string, string>;
  events: string[];
  suspended: boolean;
  repoIds: number[];
}

export interface MockRequestLog {
  route: string;
  mutating: boolean;
  authKind: string;
  repo?: string;
}

export class MockGithub implements GithubTransport {
  installations = new Map<number, MockInstallation>();
  repos = new Map<number, MockRepo>();
  /** Installation ids the mock OAuth user may see (GET /user/installations). */
  userInstallationIds = new Set<number>();
  tokens = new Map<string, { installationId: number; repoNames: string[]; permissions: Record<string, string> }>();
  log: MockRequestLog[] = [];
  private seq = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.installations.clear();
    this.repos.clear();
    this.tokens.clear();
    this.userInstallationIds = new Set([9001, 9003]);
    this.log = [];
    this.seq = 0;

    const mk = (id: number, owner: string, name: string) => this.addRepo(id, owner, name);
    const widgets = mk(1001, "acme", "widgets");
    widgets.files.set("main\0README.md", { sha: sha("readme"), content: Buffer.from("# widgets\n").toString("base64") });
    widgets.issues.set(1, { title: "Fix login bug", body: "Users cannot log in when the password contains a plus sign.", state: "open" });
    mk(1002, "acme", "fault-write-timeout");
    mk(1003, "acme", "fault-write-timeout-applied");
    mk(1004, "acme", "fault-write-502");
    mk(1005, "acme", "fault-write-403");
    mk(1006, "acme", "unlisted");
    mk(2001, "globex", "secret");

    this.installations.set(9001, {
      id: 9001, accountLogin: "acme", accountType: "Organization", accountId: 5001, selection: "selected",
      permissions: { ...EXPECTED_PERMISSIONS }, events: [], suspended: false, repoIds: [1001, 1002, 1003, 1004, 1005],
    });
    this.installations.set(9002, {
      id: 9002, accountLogin: "globex", accountType: "Organization", accountId: 5002, selection: "selected",
      permissions: { ...EXPECTED_PERMISSIONS }, events: [], suspended: false, repoIds: [2001],
    });
    this.installations.set(9003, {
      id: 9003, accountLogin: "overpriv", accountType: "User", accountId: 5003, selection: "all",
      permissions: { ...EXPECTED_PERMISSIONS, administration: "write" }, events: [], suspended: false, repoIds: [],
    });
  }

  addRepo(id: number, owner: string, name: string): MockRepo {
    const mainSha = sha(`main:${id}`);
    const repo: MockRepo = {
      id, owner, name, defaultBranch: "main", private: true, archived: false,
      branches: new Map([["main", mainSha]]), protectedBranches: new Set(["main"]),
      files: new Map(), issues: new Map(), pulls: [],
    };
    this.repos.set(id, repo);
    return repo;
  }

  repoByName(owner: string, name: string): MockRepo | undefined {
    return [...this.repos.values()].find((r) => r.owner.toLowerCase() === owner.toLowerCase() && r.name.toLowerCase() === name.toLowerCase());
  }

  private res(status: number, body: unknown, extra: Partial<GithubHttpResponse> = {}): GithubHttpResponse {
    this.seq += 1;
    return { status, requestId: `MOCK-${this.seq.toString(16).padStart(6, "0")}`, rateLimitRemaining: 4999, retryAfterSeconds: null, body, ...extra };
  }

  async send(req: RouteRequest, auth: GithubAuth): Promise<GithubHttpResponse> {
    const p = req.params ?? {};
    const mutating = ["createRef", "putContents", "createPull", "deleteInstallation"].includes(req.route);
    this.log.push({ route: req.route, mutating, authKind: auth.kind, repo: p.owner ? `${p.owner}/${p.repo}` : undefined });

    // --- authentication -------------------------------------------------
    if (auth.kind === "app_jwt" && auth.token !== "mock-app-jwt") return this.res(401, { message: "Bad credentials" });
    if (auth.kind === "user_token" && !auth.token.startsWith("ghu_mock_")) return this.res(401, { message: "Bad credentials" });
    let scope: { installationId: number; repoNames: string[]; permissions: Record<string, string> } | undefined;
    if (auth.kind === "installation_token") {
      scope = this.tokens.get(auth.token);
      if (!scope) return this.res(401, { message: "Bad credentials" });
    }

    if (req.route === "mintInstallationToken") {
      const inst = this.installations.get(Number(p.installationId));
      if (!inst) return this.res(404, { message: "Not Found" });
      if (inst.suspended) return this.res(403, { message: "This installation has been suspended" });
      const wanted = (req.body?.repositories as string[] | undefined) ?? [];
      const perms = (req.body?.permissions as Record<string, string> | undefined) ?? { ...inst.permissions };
      const instRepos = inst.repoIds.map((id) => this.repos.get(id)!.name);
      if (wanted.some((n) => !instRepos.includes(n))) return this.res(422, { message: "repositories not accessible" });
      for (const [k, v] of Object.entries(perms)) {
        const have = inst.permissions[k];
        const rank = (x?: string) => (x === "admin" ? 3 : x === "write" ? 2 : x === "read" ? 1 : 0);
        if (rank(have) < rank(v)) return this.res(422, { message: "permission not granted" });
      }
      const token = `ghs_mock_${randomUUID().replace(/-/g, "")}`;
      this.tokens.set(token, { installationId: inst.id, repoNames: wanted.length ? wanted : instRepos, permissions: perms });
      return this.res(201, { token, expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions: perms, repository_selection: inst.selection });
    }
    if (req.route === "getInstallation") {
      const inst = this.installations.get(Number(p.installationId));
      if (!inst) return this.res(404, { message: "Not Found" });
      return this.res(200, {
        id: inst.id, account: { login: inst.accountLogin, type: inst.accountType, id: inst.accountId },
        repository_selection: inst.selection, permissions: inst.permissions, events: inst.events,
        suspended_at: inst.suspended ? new Date().toISOString() : null,
      });
    }
    if (req.route === "deleteInstallation") {
      return this.installations.delete(Number(p.installationId)) ? this.res(204, null) : this.res(404, { message: "Not Found" });
    }
    if (req.route === "getUserInstallations") {
      const installations = [...this.userInstallationIds].map((id) => this.installations.get(id)).filter(Boolean).map((i) => ({ id: i!.id }));
      return this.res(200, { total_count: installations.length, installations });
    }
    if (req.route === "listInstallationRepositories") {
      const inst = this.installations.get(scope!.installationId)!;
      const repositories = inst.repoIds.map((id) => this.repos.get(id)!).filter((r) => scope!.repoNames.includes(r.name)).map((r) => this.repoJson(r));
      return this.res(200, { total_count: repositories.length, repository_selection: inst.selection, repositories });
    }

    // --- repository-scoped routes ----------------------------------------
    const repo = this.repoByName(String(p.owner), String(p.repo));
    const inScope = repo && scope!.repoNames.includes(repo.name) && this.installations.get(scope!.installationId)!.repoIds.includes(repo.id);
    if (!repo || !inScope) return this.res(404, { message: "Not Found" });
    const perm = (name: string, level: "read" | "write") => {
      const have = scope!.permissions[name];
      return have === "write" || have === "admin" || (level === "read" && have === "read");
    };

    if (mutating) {
      if (repo.name === "fault-write-timeout") throw new TransportError("timeout");
      if (repo.name === "fault-write-502") return this.res(502, { message: "Bad Gateway" });
      if (repo.name === "fault-write-403") return this.res(403, { message: "Resource not accessible by integration" });
    }

    switch (req.route) {
      case "getRepository":
        return this.res(200, this.repoJson(repo));
      case "getIssue": {
        if (!perm("issues", "read")) return this.res(403, { message: "Resource not accessible by integration" });
        const issue = repo.issues.get(Number(p.number));
        if (!issue) return this.res(404, { message: "Not Found" });
        return this.res(200, { number: Number(p.number), title: issue.title, body: issue.body, state: issue.state, html_url: `https://github.com/${repo.owner}/${repo.name}/issues/${p.number}` });
      }
      case "getContents": {
        if (!perm("contents", "read")) return this.res(403, { message: "Resource not accessible by integration" });
        const ref = String(req.query?.ref ?? repo.defaultBranch);
        if (!repo.branches.has(ref)) return this.res(404, { message: "No commit found for the ref" });
        const file = repo.files.get(`${ref}\0${p.path}`);
        if (!file) {
          const dir = [...repo.files.keys()].some((k) => k.startsWith(`${ref}\0${p.path}/`));
          return dir ? this.res(200, [{ type: "dir", path: String(p.path) }]) : this.res(404, { message: "Not Found" });
        }
        return this.res(200, { type: "file", path: String(p.path), sha: file.sha, size: Buffer.from(file.content, "base64").length, encoding: "base64", content: file.content });
      }
      case "getBranch": {
        if (!perm("contents", "read")) return this.res(403, { message: "Resource not accessible by integration" });
        const s = repo.branches.get(String(p.branch));
        return s ? this.res(200, { name: String(p.branch), protected: repo.protectedBranches.has(String(p.branch)), commit: { sha: s } }) : this.res(404, { message: "Branch not found" });
      }
      case "getRef": {
        const s = repo.branches.get(String(p.branch));
        return s ? this.res(200, { ref: `refs/heads/${p.branch}`, object: { sha: s, type: "commit" } }) : this.res(404, { message: "Not Found" });
      }
      case "createRef": {
        if (!perm("contents", "write")) return this.res(403, { message: "Resource not accessible by integration" });
        const ref = String(req.body?.ref ?? "");
        const target = String(req.body?.sha ?? "");
        const name = ref.replace(/^refs\/heads\//, "");
        if (!ref.startsWith("refs/heads/") || ![...repo.branches.values()].includes(target)) return this.res(422, { message: "Object does not exist" });
        if (repo.branches.has(name)) return this.res(422, { message: "Reference already exists" });
        repo.branches.set(name, target);
        // Mirror the base branch's files onto the new branch.
        for (const [k, f] of [...repo.files]) {
          const [b, path] = k.split("\0");
          const baseName = [...repo.branches.entries()].find(([n, s]) => s === target && n !== name)?.[0];
          if (b === baseName) repo.files.set(`${name}\0${path}`, f);
        }
        if (repo.name === "fault-write-timeout-applied") throw new TransportError("timeout");
        return this.res(201, { ref, object: { sha: target } });
      }
      case "putContents": {
        if (!perm("contents", "write")) return this.res(403, { message: "Resource not accessible by integration" });
        const branch = String(req.body?.branch ?? repo.defaultBranch);
        if (!repo.branches.has(branch)) return this.res(404, { message: "Branch not found" });
        if (repo.protectedBranches.has(branch)) return this.res(403, { message: "Protected branch update failed" });
        const key = `${branch}\0${p.path}`;
        const existing = repo.files.get(key);
        const given = req.body?.sha as string | undefined;
        if (existing && !given) return this.res(422, { message: "\"sha\" wasn't supplied." });
        if (existing && given !== existing.sha) return this.res(409, { message: "does not match" });
        const content = String(req.body?.content ?? "");
        const blob = sha(`blob:${p.path}:${content}`);
        const commit = sha(`commit:${repo.branches.get(branch)}:${blob}:${++this.seq}`);
        repo.files.set(key, { sha: blob, content });
        repo.branches.set(branch, commit);
        if (repo.name === "fault-write-timeout-applied") throw new TransportError("timeout");
        return this.res(existing ? 200 : 201, { content: { sha: blob, path: String(p.path) }, commit: { sha: commit } });
      }
      case "listPulls": {
        if (!perm("pull_requests", "read")) return this.res(403, { message: "Resource not accessible by integration" });
        const head = String(req.query?.head ?? "").split(":")[1];
        const base = req.query?.base ? String(req.query.base) : undefined;
        const state = String(req.query?.state ?? "open");
        const list = repo.pulls.filter((x) => (!head || x.head === head) && (!base || x.base === base) && (state === "all" || x.state === state));
        return this.res(200, list.map((x) => this.pullJson(repo, x)));
      }
      case "createPull": {
        if (!perm("pull_requests", "write")) return this.res(403, { message: "Resource not accessible by integration" });
        const head = String(req.body?.head ?? "");
        const base = String(req.body?.base ?? "");
        const headSha = repo.branches.get(head);
        if (!headSha || !repo.branches.has(base)) return this.res(422, { message: "Validation Failed" });
        if (headSha === repo.branches.get(base)) return this.res(422, { message: "No commits between base and head" });
        if (repo.pulls.some((x) => x.state === "open" && x.head === head && x.base === base)) return this.res(422, { message: "A pull request already exists" });
        const pull: MockPull = { number: repo.pulls.length + 1, title: String(req.body?.title ?? ""), state: "open", head, base, headSha, draft: Boolean(req.body?.draft) };
        repo.pulls.push(pull);
        if (repo.name === "fault-write-timeout-applied") throw new TransportError("timeout");
        return this.res(201, this.pullJson(repo, pull));
      }
      case "getPull": {
        if (!perm("pull_requests", "read")) return this.res(403, { message: "Resource not accessible by integration" });
        const pull = repo.pulls.find((x) => x.number === Number(p.number));
        return pull ? this.res(200, this.pullJson(repo, pull)) : this.res(404, { message: "Not Found" });
      }
      default:
        return this.res(404, { message: "Not Found" });
    }
  }

  private repoJson(r: MockRepo) {
    return { id: r.id, name: r.name, full_name: `${r.owner}/${r.name}`, owner: { login: r.owner }, default_branch: r.defaultBranch, private: r.private, archived: r.archived };
  }
  private pullJson(r: MockRepo, x: MockPull) {
    return {
      number: x.number, state: x.state, title: x.title, draft: x.draft, merged: false,
      html_url: `https://github.com/${r.owner}/${r.name}/pull/${x.number}`,
      head: { ref: x.head, sha: x.headSha }, base: { ref: x.base },
    };
  }
}

const g = globalThis as unknown as { __authorityMockGithub?: MockGithub };
export function mockGithub(): MockGithub {
  g.__authorityMockGithub ??= new MockGithub();
  return g.__authorityMockGithub;
}
