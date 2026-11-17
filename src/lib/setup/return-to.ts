/**
 * Where a connector's consent flow may send the browser back to after it finishes. Only the Setup page, on this
 * same origin, is allowed: anything else (another site, a protocol-relative `//host`, a backslash trick, an
 * encoded `..`, a path that merely starts with the same letters such as `/app/setupx`) is refused, and the caller
 * falls back to its own default page.
 *
 * Pure and isomorphic: the connect routes, their callbacks and the integration pages' "Back to setup" link all
 * use the same check, and it is unit-tested on its own (src/tests/unit/setup/return-to.test.ts).
 */

export const SETUP_PATH = "/app/setup";

/** Cookie the Gmail and GitHub connect routes set so their callbacks can return to Setup. */
export const RETURN_TO_COOKIE = "authority_setup_return_to";

const MAX_LENGTH = 1024;
const SENTINEL_ORIGIN = "http://return-to.invalid";

export function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_LENGTH) return null;
  // Must be a single-slash absolute path: never `//host`, `/\host`, a scheme, or a relative path.
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  // Backslashes, whitespace and control characters are never part of a path we build.
  if (/[\\\s\u0000-\u001f\u007f]/.test(raw)) return null;

  const pathPart = raw.split(/[?#]/, 1)[0] ?? "";
  // Encoded separators or dots in the path are a trick, never something Setup links to.
  if (/%(2f|5c|2e|00)/i.test(pathPart)) return null;

  let url: URL;
  try {
    url = new URL(raw, SENTINEL_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== SENTINEL_ORIGIN) return null;
  // `..` or `.` segments were normalized away: what the browser would load is not what was written.
  if (url.pathname !== pathPart) return null;
  if (url.pathname !== SETUP_PATH && !url.pathname.startsWith(`${SETUP_PATH}/`)) return null;

  return `${url.pathname}${url.search}`;
}

/**
 * A Setup URL from the progress kept in the query string. Shared by the server page and its client panels (a
 * function exported from a "use client" module cannot be called on the server).
 */
export function setupHref(params: { app?: string | null; connection?: string | null; task?: string | null }) {
  const query = new URLSearchParams();
  if (params.app) query.set("app", params.app);
  if (params.connection) query.set("connection", params.connection);
  if (params.task) query.set("task", params.task);
  const text = query.toString();
  return text ? `${SETUP_PATH}?${text}` : SETUP_PATH;
}

/** Adds (or replaces) one query parameter on a path already accepted by `safeReturnTo`. */
export function withQueryParam(path: string, key: string, value: string): string {
  const url = new URL(path, SENTINEL_ORIGIN);
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

/**
 * The redirect URL for `target` on `base`, re-checked after resolution: if it would leave `base`'s origin for any
 * reason, the caller's own `fallback` page is used instead. Belt and braces over `safeReturnTo`.
 */
export function sameOriginUrl(target: string, base: string, fallback: string): URL {
  const origin = new URL(base).origin;
  const url = new URL(target, origin);
  return url.origin === origin ? url : new URL(fallback, origin);
}
