/** Error taxonomy: whether a failure is DEFINITE (nothing was written) or the outcome is UNKNOWN. */

export class GithubDefiniteError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  constructor(code: string, httpStatus: number | null = null) {
    super(code);
    this.name = "GithubDefiniteError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** A write may or may not have been applied (timeout, connection loss, 5xx after dispatch). Never auto-retried. */
export class GithubIndeterminateError extends Error {
  readonly code: string;
  readonly httpStatus: number | null;
  constructor(code: string, httpStatus: number | null = null) {
    super(code);
    this.name = "GithubIndeterminateError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** Raised by transports: the request left (or may have left) but no usable response arrived. */
export class TransportError extends Error {
  readonly kind: "timeout" | "network" | "too_large" | "redirect" | "bad_json" | "aborted";
  constructor(kind: TransportError["kind"]) {
    super(kind);
    this.name = "TransportError";
    this.kind = kind;
  }
}
