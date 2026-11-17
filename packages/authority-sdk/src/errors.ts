/**
 * Thrown for every non-2xx response from the Authority API: bad credential,
 * malformed request, not-found, rate limiting, upstream unavailability.
 *
 * Distinct from a tool call's own "denied" / "requires_approval" outcome --
 * those are ordinary, successful (HTTP 200) decisions returned as typed
 * result values from `AgentClient.tools.execute`, never thrown. This class
 * is reserved for requests that could not be completed at all.
 */
export class AuthorityApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  /** The server's full error body, already sanitized -- safe to log. */
  readonly body: unknown;

  constructor(
    message: string,
    options: { status: number; code: string; requestId?: string; body?: unknown },
  ) {
    super(message);
    this.name = "AuthorityApiError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.body = options.body;
  }
}

/** The request was aborted (caller's own AbortSignal, or the client's own timeout) before a response arrived. */
export class AuthorityTimeoutError extends Error {
  /** "aborted": the caller's own AbortSignal fired; "timeout": the client's own timeout elapsed. */
  readonly reason: "timeout" | "aborted";

  constructor(message = "The request timed out or was aborted.", reason: "timeout" | "aborted" = "timeout") {
    super(message);
    this.name = "AuthorityTimeoutError";
    this.reason = reason;
  }
}

/**
 * The SDK was used incorrectly: a missing option, an action whose connector has no connection, a missing
 * idempotency key. Always thrown before any network request is made.
 */
export class AuthorityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorityConfigError";
  }
}
