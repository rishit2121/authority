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
  constructor(message = "The request timed out or was aborted.") {
    super(message);
    this.name = "AuthorityTimeoutError";
  }
}
