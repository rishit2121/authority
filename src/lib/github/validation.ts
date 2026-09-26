/**
 * Pure validators for everything an agent can influence in a GitHub request.
 * The connector never builds a URL from a string an agent supplied: values
 * that pass through here become *parameters* of a fixed route template.
 */

export type Validated<T> = { ok: true; value: T } | { ok: false; code: string };

const OWNER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const REPO_NAME = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const SHA = /^[0-9a-f]{40}$/;

export function parseRepositoryFullName(
  value: unknown,
): Validated<{ owner: string; name: string; fullName: string }> {
  if (typeof value !== "string") return { ok: false, code: "REPOSITORY_INVALID" };
  const parts = value.split("/");
  if (parts.length !== 2 || !OWNER.test(parts[0]) || !REPO_NAME.test(parts[1])) {
    return { ok: false, code: "REPOSITORY_INVALID" };
  }
  return { ok: true, value: { owner: parts[0], name: parts[1], fullName: value } };
}

export function isSha(value: unknown): value is string {
  return typeof value === "string" && SHA.test(value);
}

export function parsePositiveInt(value: unknown, max = 1_000_000_000): Validated<number> {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[0-9]{1,10}$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > max) return { ok: false, code: "NUMBER_INVALID" };
  return { ok: true, value: n };
}

const PATH_SEGMENT = /^[A-Za-z0-9._@+=,-]{1,100}$/;

/**
 * Repository file paths. Rejects traversal (`..`, `.`), absolute paths,
 * backslashes, empty segments, ANY percent-encoding (so `%2e%2e` and double
 * encoding are refused rather than decoded), control and non-ASCII
 * characters, `.git` internals, and the `.github/workflows` directory (writing
 * workflows needs a permission this App deliberately never holds).
 */
export function normalizeRepositoryPath(value: unknown): Validated<string> {
  if (typeof value !== "string" || value.length === 0 || value.length > 240)
    return { ok: false, code: "PATH_INVALID" };
  if (value.includes("%") || value.includes("\\") || value.includes("\0"))
    return { ok: false, code: "PATH_AMBIGUOUS" };
  if (/[\u0000-\u001f\u007f-￿]/.test(value)) return { ok: false, code: "PATH_AMBIGUOUS" };
  if (value.startsWith("/") || value.endsWith("/")) return { ok: false, code: "PATH_INVALID" };
  const segments = value.split("/");
  if (segments.length > 12) return { ok: false, code: "PATH_INVALID" };
  for (const segment of segments) {
    if (segment === "." || segment === ".." || segment === "") return { ok: false, code: "PATH_TRAVERSAL" };
    if (!PATH_SEGMENT.test(segment)) return { ok: false, code: "PATH_INVALID" };
  }
  const lower = segments.map((s) => s.toLowerCase());
  if (lower.includes(".git")) return { ok: false, code: "PATH_FORBIDDEN" };
  if (lower[0] === ".github" && lower[1] === "workflows") return { ok: false, code: "PATH_FORBIDDEN" };
  return { ok: true, value: segments.join("/") };
}

/** Deterministic task branch namespace: `authority/<first 8 hex of task id>/`. */
export function taskBranchPrefix(taskId: string): string {
  return `authority/${taskId.replace(/-/g, "").slice(0, 8).toLowerCase()}/`;
}

const BRANCH_TAIL = /^[a-z0-9][a-z0-9._-]{0,62}(?:\/[a-z0-9][a-z0-9._-]{0,62}){0,2}$/;

/**
 * A branch the connector may create or write. It must live under the task's own
 * namespace, which is also what makes a direct write to the default or any
 * other existing branch unrepresentable.
 */
export function validateTaskBranch(value: unknown, taskId: string): Validated<string> {
  if (typeof value !== "string" || value.length > 120) return { ok: false, code: "BRANCH_INVALID" };
  const prefix = taskBranchPrefix(taskId);
  if (!value.startsWith(prefix)) return { ok: false, code: "BRANCH_OUTSIDE_TASK_NAMESPACE" };
  const tail = value.slice(prefix.length);
  if (
    !BRANCH_TAIL.test(tail) ||
    tail.includes("..") ||
    tail.endsWith(".") ||
    tail.endsWith(".lock") ||
    tail.includes("@{")
  ) {
    return { ok: false, code: "BRANCH_INVALID" };
  }
  return { ok: true, value };
}

const REF_NAME = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){0,4}$/;

/** A branch to READ from (base branch or read ref). Not writable; only its shape is checked. */
export function validateReadRef(value: unknown): Validated<string> {
  if (typeof value !== "string" || value.length === 0 || value.length > 200)
    return { ok: false, code: "REF_INVALID" };
  if (
    !REF_NAME.test(value) ||
    value.includes("..") ||
    value.endsWith(".lock") ||
    value.endsWith(".") ||
    value.startsWith("-")
  ) {
    return { ok: false, code: "REF_INVALID" };
  }
  return { ok: true, value };
}

export function isDefaultBranch(branch: string, defaultBranch: string): boolean {
  return branch === defaultBranch;
}

export function isGithubHtmlUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\/github\.com\/[A-Za-z0-9._\-/]{1,300}$/.test(value);
}
