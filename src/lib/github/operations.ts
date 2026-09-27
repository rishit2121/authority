import "server-only";

import { z } from "zod";

import type { GithubClient, SecretToken } from "./client";
import {
  MAX_COMMIT_MESSAGE_CHARS,
  MAX_FILE_RETURN_BYTES,
  MAX_PR_BODY_CHARS,
  MAX_PR_TITLE_CHARS,
} from "./constants";
import { GithubDefiniteError } from "./errors";
import { redactText, redactValue, type RedactionCounts } from "./redact";
import {
  isDefaultBranch,
  isGithubHtmlUrl,
  isSensitiveRepositoryPath,
  isSha,
  normalizeRepositoryPath,
  parsePositiveInt,
  validateReadRef,
  validateTaskBranch,
} from "./validation";

/**
 * One entry per Authority tool operation. Each maps to fixed GitHub routes
 * (see routes.ts) and a strict argument schema; the agent supplies neither a
 * URL, a method nor a path.
 */

export type Permissions = Record<string, "read" | "write">;

export interface ExecutionContext {
  client: GithubClient;
  token: SecretToken;
  owner: string;
  repo: string;
  taskId: string;
  signal: AbortSignal;
  /** Called immediately before a state-changing request is sent. */
  beforeWrite: () => void;
}

export interface OperationResult {
  category: "succeeded" | "succeeded_noop";
  resourceIds: Record<string, unknown>;
  beforeSha: string | null;
  afterSha: string | null;
  githubRequestId: string | null;
  httpStatusClass: number;
  /** What the agent receives (redacted, never stored). */
  agentPayload: Record<string, unknown>;
  redaction: RedactionCounts;
}

export interface OperationSpec {
  tool: string;
  mutating: boolean;
  /** Least-privilege installation-token permissions this operation needs. */
  permissions: Permissions;
  parse(args: Record<string, unknown>): Record<string, unknown>;
  /** Pure validation that needs no network; failing here releases the reservation. */
  precheck(args: Record<string, unknown>, env: { taskId: string; defaultBranch: string }): void;
  run(ctx: ExecutionContext, args: Record<string, unknown>, defaultBranch: string): Promise<OperationResult>;
}

const ignoreRepository = z.string().max(200).optional();
const digits = z.union([z.string().regex(/^[0-9]{1,10}$/), z.number().int().positive()]);

const auth = (ctx: ExecutionContext) => ctx.client.installationAuth(ctx.token);
const sig = (ctx: ExecutionContext) => ({ signal: ctx.signal });
const params = (ctx: ExecutionContext, extra: Record<string, string | number> = {}) => ({
  owner: ctx.owner,
  repo: ctx.repo,
  ...extra,
});
const cls = (status: number) => Math.floor(status / 100);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function reject(code: string): never {
  throw new GithubDefiniteError(code);
}
function need<T>(v: { ok: true; value: T } | { ok: false; code: string }): T {
  if (!v.ok) reject(v.code);
  return v.value;
}

async function currentDefaultBranch(
  ctx: ExecutionContext,
  storedDefault: string,
): Promise<{ name: string; requestId: string | null }> {
  const r = await ctx.client.request({ route: "getRepository", params: params(ctx) }, auth(ctx), sig(ctx));
  const body = r.body as { default_branch?: string; archived?: boolean } | null;
  if (body?.archived) reject("REPOSITORY_ARCHIVED");
  const live = str(body?.default_branch);
  if (!live) reject("REPOSITORY_METADATA_INVALID");
  // A renamed default branch means our stored view is stale: refuse rather than guess.
  if (live !== storedDefault) reject("DEFAULT_BRANCH_CHANGED");
  return { name: live, requestId: r.requestId };
}

async function branchSha(
  ctx: ExecutionContext,
  branch: string,
): Promise<{ sha: string | null; requestId: string | null }> {
  const r = await ctx.client.request({ route: "getRef", params: params(ctx, { branch }) }, auth(ctx), {
    ...sig(ctx),
    tolerate: [404],
  });
  if (r.status === 404) return { sha: null, requestId: r.requestId };
  const sha = (r.body as { object?: { sha?: string } } | null)?.object?.sha;
  if (!isSha(sha)) reject("REF_INVALID_RESPONSE");
  return { sha, requestId: r.requestId };
}

// ---------------------------------------------------------------------------
const getIssue: OperationSpec = {
  tool: "github.get_issue",
  mutating: false,
  permissions: { issues: "read", metadata: "read" },
  parse: (a) => z.object({ issue_number: digits, repository: ignoreRepository }).strict().parse(a),
  precheck(args) {
    need(parsePositiveInt(args.issue_number));
  },
  async run(ctx, args) {
    const n = need(parsePositiveInt(args.issue_number));
    const r = await ctx.client.request(
      { route: "getIssue", params: params(ctx, { number: n }) },
      auth(ctx),
      sig(ctx),
    );
    const b = r.body as Record<string, unknown>;
    const counts: RedactionCounts = {};
    return {
      category: "succeeded",
      resourceIds: { issueNumber: n, htmlUrl: isGithubHtmlUrl(b.html_url) ? b.html_url : undefined },
      beforeSha: null,
      afterSha: null,
      githubRequestId: r.requestId,
      httpStatusClass: cls(r.status),
      agentPayload: redactValue(
        {
          number: n,
          title: str(b.title),
          state: str(b.state),
          body: redactText(str(b.body).slice(0, 8000), counts),
          htmlUrl: b.html_url,
          isPullRequest: b.pull_request !== undefined,
        },
        counts,
      ),
      redaction: counts,
    };
  },
};

const readRepository: OperationSpec = {
  tool: "github.read_repository",
  mutating: false,
  permissions: { contents: "read", metadata: "read" },
  parse: (a) =>
    z
      .object({
        repository: ignoreRepository,
        path: z.string().max(240).optional(),
        ref: z.string().max(200).optional(),
      })
      .strict()
      .parse(a),
  precheck(args) {
    if (typeof args.path === "string") {
      const p = need(normalizeRepositoryPath(args.path));
      if (isSensitiveRepositoryPath(p)) reject("PATH_SENSITIVE");
    }
    if (args.ref !== undefined) need(validateReadRef(args.ref));
  },
  async run(ctx, args, defaultBranch) {
    const repo = await ctx.client.request(
      { route: "getRepository", params: params(ctx) },
      auth(ctx),
      sig(ctx),
    );
    const meta = repo.body as {
      name?: string;
      default_branch?: string;
      private?: boolean;
      archived?: boolean;
    };
    const counts: RedactionCounts = {};
    const payload: Record<string, unknown> = {
      repository: `${ctx.owner}/${ctx.repo}`,
      defaultBranch: meta.default_branch ?? defaultBranch,
      private: Boolean(meta.private),
      archived: Boolean(meta.archived),
    };
    let requestId = repo.requestId;
    if (typeof args.path === "string") {
      const path = need(normalizeRepositoryPath(args.path));
      const ref = args.ref === undefined ? undefined : need(validateReadRef(args.ref));
      const file = await ctx.client.request(
        { route: "getContents", params: params(ctx, { path }), query: ref ? { ref } : {} },
        auth(ctx),
        sig(ctx),
      );
      requestId = file.requestId ?? requestId;
      const fb = file.body as
        { type?: string; sha?: string; size?: number; content?: string; encoding?: string } | unknown[];
      if (Array.isArray(fb) || (fb as { type?: string }).type !== "file") reject("PATH_IS_DIRECTORY");
      const f = fb as { sha?: string; size?: number; content?: string; encoding?: string };
      if ((f.size ?? 0) > MAX_FILE_RETURN_BYTES || f.encoding !== "base64" || typeof f.content !== "string")
        reject("FILE_TOO_LARGE");
      payload.file = {
        path,
        sha: f.sha,
        size: f.size,
        content: redactText(Buffer.from(f.content, "base64").toString("utf8"), counts),
      };
    }
    return {
      category: "succeeded",
      resourceIds: {
        repository: `${ctx.owner}/${ctx.repo}`,
        ...(typeof args.path === "string" ? { path: args.path } : {}),
      },
      beforeSha: null,
      afterSha: null,
      githubRequestId: requestId,
      httpStatusClass: 2,
      agentPayload: payload,
      redaction: counts,
    };
  },
};

const createBranch: OperationSpec = {
  tool: "github.create_branch",
  mutating: true,
  permissions: { contents: "write", metadata: "read" },
  parse: (a) =>
    z
      .object({
        repository: ignoreRepository,
        branch: z.string().max(120),
        base_branch: z.string().max(200).optional(),
        base_sha: z.string().length(40).optional(),
      })
      .strict()
      .parse(a),
  precheck(args, env) {
    need(validateTaskBranch(args.branch, env.taskId));
    if (args.base_branch !== undefined) {
      const base = need(validateReadRef(args.base_branch));
      if (!isDefaultBranch(base, env.defaultBranch) && !validateTaskBranch(base, env.taskId).ok)
        reject("BASE_BRANCH_NOT_ALLOWED");
    }
    if (args.base_sha !== undefined && !isSha(args.base_sha)) reject("SHA_INVALID");
  },
  async run(ctx, args, defaultBranch) {
    const branch = need(validateTaskBranch(args.branch, ctx.taskId));
    await currentDefaultBranch(ctx, defaultBranch);
    const baseName = args.base_branch === undefined ? defaultBranch : need(validateReadRef(args.base_branch));
    // The base must be the default branch or another branch in this task's own namespace.
    if (!isDefaultBranch(baseName, defaultBranch) && !validateTaskBranch(baseName, ctx.taskId).ok)
      reject("BASE_BRANCH_NOT_ALLOWED");
    const expectedBase =
      args.base_sha === undefined ? null : isSha(args.base_sha) ? args.base_sha : reject("SHA_INVALID");

    const base = await branchSha(ctx, baseName);
    if (!base.sha) reject("BASE_BRANCH_NOT_FOUND");
    if (expectedBase && base.sha !== expectedBase) reject("BASE_SHA_MISMATCH");

    // Check-before-create: an existing branch at the base commit is an idempotent success.
    const existing = await branchSha(ctx, branch);
    const done = (
      category: "succeeded" | "succeeded_noop",
      requestId: string | null,
      status: number,
    ): OperationResult => ({
      category,
      resourceIds: { branch, base: baseName },
      beforeSha: category === "succeeded" ? null : base.sha,
      afterSha: base.sha,
      githubRequestId: requestId,
      httpStatusClass: status,
      agentPayload: { branch, sha: base.sha, created: category === "succeeded" },
      redaction: {},
    });
    if (existing.sha) {
      if (existing.sha === base.sha) return done("succeeded_noop", existing.requestId, 2);
      reject("BRANCH_EXISTS_DIVERGED");
    }

    ctx.beforeWrite();
    try {
      const r = await ctx.client.request(
        { route: "createRef", params: params(ctx), body: { ref: `refs/heads/${branch}`, sha: base.sha } },
        auth(ctx),
        sig(ctx),
      );
      return done("succeeded", r.requestId, cls(r.status));
    } catch (error) {
      // 422 "already exists" can be a race with ourselves; re-read to decide, never assume.
      if (error instanceof GithubDefiniteError && error.httpStatus === 422) {
        const again = await branchSha(ctx, branch);
        if (again.sha === base.sha) return done("succeeded_noop", again.requestId, 2);
      }
      throw error;
    }
  },
};

const putFile: OperationSpec = {
  tool: "github.put_file",
  mutating: true,
  permissions: { contents: "write", metadata: "read" },
  parse: (a) =>
    z
      .object({
        repository: ignoreRepository,
        branch: z.string().max(120),
        path: z.string().max(240),
        content: z.string().max(4096),
        message: z.string().min(1).max(MAX_COMMIT_MESSAGE_CHARS),
        expected_sha: z.string().length(40).optional(),
      })
      .strict()
      .parse(a),
  precheck(args, env) {
    const branch = need(validateTaskBranch(args.branch, env.taskId));
    if (isSensitiveRepositoryPath(need(normalizeRepositoryPath(args.path)))) reject("PATH_SENSITIVE");
    if (isDefaultBranch(branch, env.defaultBranch)) reject("DEFAULT_BRANCH_WRITE_FORBIDDEN");
    if (
      !str(args.message)
        .replace(/[\r\n]+/g, " ")
        .trim()
    )
      reject("MESSAGE_INVALID");
    if (args.expected_sha !== undefined && !isSha(args.expected_sha)) reject("SHA_INVALID");
  },
  async run(ctx, args, defaultBranch) {
    const branch = need(validateTaskBranch(args.branch, ctx.taskId));
    const path = need(normalizeRepositoryPath(args.path));
    const content = str(args.content);
    const message = str(args.message)
      .replace(/[\r\n]+/g, " ")
      .trim();
    if (!message) reject("MESSAGE_INVALID");
    if (isDefaultBranch(branch, defaultBranch)) reject("DEFAULT_BRANCH_WRITE_FORBIDDEN");
    const expectedSha =
      args.expected_sha === undefined
        ? null
        : isSha(args.expected_sha)
          ? args.expected_sha
          : reject("SHA_INVALID");

    await currentDefaultBranch(ctx, defaultBranch);
    const b = await ctx.client.request({ route: "getBranch", params: params(ctx, { branch }) }, auth(ctx), {
      ...sig(ctx),
      tolerate: [404],
    });
    if (b.status === 404) reject("BRANCH_NOT_FOUND");
    const bb = b.body as { protected?: boolean; commit?: { sha?: string } };
    if (bb.protected) reject("PROTECTED_BRANCH_WRITE_FORBIDDEN");
    const before = isSha(bb.commit?.sha) ? bb.commit.sha : null;

    const cur = await ctx.client.request(
      { route: "getContents", params: params(ctx, { path }), query: { ref: branch } },
      auth(ctx),
      { ...sig(ctx), tolerate: [404] },
    );
    let existingSha: string | null = null;
    if (cur.status !== 404) {
      const cb = cur.body as { type?: string; sha?: string; content?: string; encoding?: string } | unknown[];
      if (Array.isArray(cb) || (cb as { type?: string }).type !== "file") reject("PATH_IS_DIRECTORY");
      const f = cb as { sha?: string; content?: string };
      existingSha = str(f.sha);
      // Identical content already present: idempotent success without a new commit.
      if (typeof f.content === "string" && Buffer.from(f.content, "base64").toString("utf8") === content) {
        return {
          category: "succeeded_noop",
          resourceIds: { branch, path },
          beforeSha: before,
          afterSha: before,
          githubRequestId: cur.requestId,
          httpStatusClass: 2,
          agentPayload: { branch, path, blobSha: existingSha, committed: false },
          redaction: {},
        };
      }
      if (!expectedSha) reject("EXPECTED_SHA_REQUIRED");
      if (expectedSha !== existingSha) reject("SHA_MISMATCH");
    } else if (expectedSha) {
      reject("SHA_MISMATCH");
    }

    ctx.beforeWrite();
    const r = await ctx.client.request(
      {
        route: "putContents",
        params: params(ctx, { path }),
        body: {
          message,
          content: Buffer.from(content, "utf8").toString("base64"),
          branch,
          ...(existingSha ? { sha: existingSha } : {}),
        },
      },
      auth(ctx),
      sig(ctx),
    );
    const rb = r.body as { commit?: { sha?: string }; content?: { sha?: string } };
    const after = isSha(rb.commit?.sha) ? rb.commit.sha : null;
    return {
      category: "succeeded",
      resourceIds: { branch, path, commitSha: after },
      beforeSha: before,
      afterSha: after,
      githubRequestId: r.requestId,
      httpStatusClass: cls(r.status),
      agentPayload: { branch, path, blobSha: rb.content?.sha ?? null, commitSha: after, committed: true },
      redaction: {},
    };
  },
};

const createPullRequest: OperationSpec = {
  tool: "github.create_pull_request",
  mutating: true,
  permissions: { pull_requests: "write", contents: "read", metadata: "read" },
  parse: (a) =>
    z
      .object({
        repository: ignoreRepository,
        head: z.string().max(120).optional(),
        head_branch: z.string().max(120).optional(),
        base: z.string().max(200).optional(),
        target_branch: z.string().max(200).optional(),
        title: z.string().min(1).max(MAX_PR_TITLE_CHARS),
        body: z.string().max(MAX_PR_BODY_CHARS).optional(),
        draft: z.boolean().optional(),
      })
      .strict()
      .parse(a),
  precheck(args, env) {
    need(validateTaskBranch(args.head ?? args.head_branch, env.taskId));
    if ((args.base ?? args.target_branch ?? env.defaultBranch) !== env.defaultBranch)
      reject("PR_BASE_NOT_ALLOWED");
  },
  async run(ctx, args, defaultBranch) {
    const headRaw = args.head ?? args.head_branch;
    const baseRaw = args.base ?? args.target_branch ?? defaultBranch;
    const head = need(validateTaskBranch(headRaw, ctx.taskId));
    // A PR may only target the repository's default branch.
    if (baseRaw !== defaultBranch) reject("PR_BASE_NOT_ALLOWED");
    await currentDefaultBranch(ctx, defaultBranch);

    const listQuery = { head: `${ctx.owner}:${head}`, base: defaultBranch, state: "open", per_page: 5 };
    const summarize = (
      p: Record<string, unknown>,
      category: "succeeded" | "succeeded_noop",
      requestId: string | null,
      status: number,
    ): OperationResult => {
      const url = isGithubHtmlUrl(p.html_url) ? p.html_url : undefined;
      return {
        category,
        resourceIds: { pullNumber: p.number, htmlUrl: url, head, base: defaultBranch },
        beforeSha: null,
        afterSha: isSha((p.head as { sha?: string } | undefined)?.sha)
          ? (p.head as { sha: string }).sha
          : null,
        githubRequestId: requestId,
        httpStatusClass: status,
        agentPayload: {
          number: p.number,
          htmlUrl: url ?? null,
          state: p.state,
          created: category === "succeeded",
        },
        redaction: {},
      };
    };

    const existing = await ctx.client.request(
      { route: "listPulls", params: params(ctx), query: listQuery },
      auth(ctx),
      sig(ctx),
    );
    const found = (existing.body as Array<Record<string, unknown>>)?.[0];
    if (found) return summarize(found, "succeeded_noop", existing.requestId, 2);

    const headRef = await branchSha(ctx, head);
    if (!headRef.sha) reject("HEAD_BRANCH_NOT_FOUND");

    ctx.beforeWrite();
    try {
      const r = await ctx.client.request(
        {
          route: "createPull",
          params: params(ctx),
          body: {
            title: str(args.title),
            head,
            base: defaultBranch,
            body: str(args.body),
            draft: Boolean(args.draft),
          },
        },
        auth(ctx),
        sig(ctx),
      );
      return summarize(r.body as Record<string, unknown>, "succeeded", r.requestId, cls(r.status));
    } catch (error) {
      if (error instanceof GithubDefiniteError && error.httpStatus === 422) {
        const again = await ctx.client.request(
          { route: "listPulls", params: params(ctx), query: listQuery },
          auth(ctx),
          sig(ctx),
        );
        const f2 = (again.body as Array<Record<string, unknown>>)?.[0];
        if (f2) return summarize(f2, "succeeded_noop", again.requestId, 2);
      }
      throw error;
    }
  },
};

const getPullRequest: OperationSpec = {
  tool: "github.get_pull_request",
  mutating: false,
  permissions: { pull_requests: "read", metadata: "read" },
  parse: (a) => z.object({ pull_number: digits, repository: ignoreRepository }).strict().parse(a),
  precheck(args) {
    need(parsePositiveInt(args.pull_number));
  },
  async run(ctx, args) {
    const n = need(parsePositiveInt(args.pull_number));
    const r = await ctx.client.request(
      { route: "getPull", params: params(ctx, { number: n }) },
      auth(ctx),
      sig(ctx),
    );
    const b = r.body as Record<string, unknown> & {
      head?: { ref?: string; sha?: string };
      base?: { ref?: string };
    };
    const counts: RedactionCounts = {};
    const url = isGithubHtmlUrl(b.html_url) ? b.html_url : undefined;
    return {
      category: "succeeded",
      resourceIds: { pullNumber: n, htmlUrl: url },
      beforeSha: null,
      afterSha: isSha(b.head?.sha) ? b.head.sha : null,
      githubRequestId: r.requestId,
      httpStatusClass: cls(r.status),
      agentPayload: redactValue(
        {
          number: n,
          state: str(b.state),
          title: str(b.title),
          merged: Boolean(b.merged),
          draft: Boolean(b.draft),
          head: b.head?.ref,
          base: b.base?.ref,
          htmlUrl: url ?? null,
        },
        counts,
      ),
      redaction: counts,
    };
  },
};

const SPECS = [getIssue, readRepository, createBranch, putFile, createPullRequest, getPullRequest];
export const OPERATIONS: ReadonlyMap<string, OperationSpec> = new Map(SPECS.map((s) => [s.tool, s]));
