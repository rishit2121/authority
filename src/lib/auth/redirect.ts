/**
 * Safe redirect handling.
 *
 * Every post-authentication redirect target in this application passes through
 * `safeReturnPath`. It is an allowlist, not a blocklist: a candidate must look
 * exactly like an internal absolute path, and anything else falls back to the
 * default rather than being sanitized into shape. Sanitizing attacker-supplied
 * URLs is how open redirects get shipped.
 */

/** Where an authenticated user lands when no specific target is known. */
export const DEFAULT_AUTHENTICATED_PATH = "/app";

/** The query parameter carrying the post-login destination. */
export const RETURN_PATH_PARAM = "next";

/**
 * Auth routes are excluded as destinations. Landing back on the login page
 * after signing in reads as a failure, and `/auth/*` holds machine endpoints
 * (callback, sign-out) that must not be entered by a redirect.
 */
const EXCLUDED_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth"];

const MAX_LENGTH = 1024;

/**
 * Normalizes a candidate return path, or returns the default.
 *
 * Rejected, with the reasoning:
 *
 *  - Anything not starting with `/` — relative paths and absolute URLs alike,
 *    so `https://evil.example` and `evil.example` both fail.
 *  - `//host` and `/\host` — protocol-relative URLs, which browsers resolve to
 *    a different origin despite the leading slash. This is the classic open
 *    redirect, and `/\` is the variant that slips past a naive `//` check.
 *  - Control characters, including encoded newlines and tabs, which can be
 *    used to smuggle a second value past a parser or into a header.
 *  - A backslash anywhere in the authority position, since browsers normalize
 *    `\` to `/` inconsistently.
 *  - Anything under an auth route prefix.
 *  - Anything over 1 KiB.
 */
export function safeReturnPath(
  candidate: string | null | undefined,
  fallback: string = DEFAULT_AUTHENTICATED_PATH,
): string {
  if (typeof candidate !== "string") return fallback;

  const raw = candidate.trim();

  if (raw.length === 0 || raw.length > MAX_LENGTH) return fallback;

  // Reject control characters outright, before any parsing. Includes the
  // percent-encoded forms, which a downstream decode would revive.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  if (/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(raw)) return fallback;

  // Must be an absolute internal path.
  if (!raw.startsWith("/")) return fallback;

  // Protocol-relative and backslash-smuggled origins. The encoded forms are
  // matched case-insensitively: %5C and %5c are the same byte, and a
  // case-sensitive check here was exactly the gap that let /%5Cevil.example
  // through.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/^\/%(?:2f|5c)/i.test(raw)) return fallback;
  if (/^\/[\\/]/.test(raw)) return fallback;
  if (raw.includes("\\")) return fallback;

  // A scheme cannot appear in a path-only value.
  if (/^\/[^/?#]*:/.test(raw)) return fallback;

  // Parse against a throwaway origin to confirm it stays on that origin, and
  // to normalize the path, query and fragment consistently.
  let parsed: URL;
  try {
    parsed = new URL(raw, "https://authority.invalid");
  } catch {
    return fallback;
  }

  if (parsed.origin !== "https://authority.invalid") return fallback;

  const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;

  if (isExcluded(parsed.pathname)) return fallback;

  return normalized;
}

function isExcluded(pathname: string): boolean {
  const lowered = pathname.toLowerCase();
  return EXCLUDED_PREFIXES.some((prefix) => lowered === prefix || lowered.startsWith(`${prefix}/`));
}

/** Builds the login URL for an unauthenticated request, preserving its target. */
export function loginUrlFor(pathWithQuery: string): string {
  const target = safeReturnPath(pathWithQuery, "");
  if (target === "") return "/login";
  return `/login?${RETURN_PATH_PARAM}=${encodeURIComponent(target)}`;
}
