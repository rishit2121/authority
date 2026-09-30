/**
 * OpenRouter's documented error taxonomy (verified against openrouter.ai/docs/api_reference/errors-and-debugging):
 * 401 invalid credentials, 402 insufficient credits, 403 forbidden/guardrail, 408 timeout, 429 rate limited,
 * 502 model down, 503 no available provider. Every category here is a fixed, lowercase snake_case string safe to
 * persist and log; the response body itself is never included in a thrown message (it can echo request content).
 */
export class OpenRouterError extends Error {
  readonly category: string;
  constructor(category: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OpenRouterError";
    this.category = category;
  }
}

export class OpenRouterUnauthorizedError extends OpenRouterError {
  constructor() {
    super("unauthorized", "OpenRouter rejected the API key (401)");
    this.name = "OpenRouterUnauthorizedError";
  }
}

export class OpenRouterInsufficientCreditsError extends OpenRouterError {
  constructor() {
    super("insufficient_credits", "OpenRouter account/key has insufficient credits (402)");
    this.name = "OpenRouterInsufficientCreditsError";
  }
}

export class OpenRouterForbiddenError extends OpenRouterError {
  constructor() {
    super("forbidden", "OpenRouter refused the request (403 — guardrail or policy)");
    this.name = "OpenRouterForbiddenError";
  }
}

export class OpenRouterTimeoutError extends OpenRouterError {
  constructor(detail: string) {
    super("timeout", detail);
    this.name = "OpenRouterTimeoutError";
  }
}

export class OpenRouterRateLimitedError extends OpenRouterError {
  constructor() {
    super("rate_limited", "OpenRouter rate limit exceeded (429)");
    this.name = "OpenRouterRateLimitedError";
  }
}

/** 502 (model down) or 503 (no available provider) — the request never reached a working model. */
export class OpenRouterUpstreamUnavailableError extends OpenRouterError {
  constructor(status: number) {
    super("upstream_unavailable", `OpenRouter's upstream provider was unavailable (${status})`);
    this.name = "OpenRouterUpstreamUnavailableError";
  }
}

export class OpenRouterOutputTooLargeError extends OpenRouterError {
  constructor(detail: string) {
    super("output_too_large", detail);
    this.name = "OpenRouterOutputTooLargeError";
  }
}

export class OpenRouterMalformedResponseError extends OpenRouterError {
  constructor(detail: string) {
    super("malformed_output", detail);
    this.name = "OpenRouterMalformedResponseError";
  }
}

/** Not configured at all (no API key) — a normal, supported state, never thrown mid-request. */
export class OpenRouterUnavailableError extends OpenRouterError {
  constructor(message: string) {
    super("unavailable", message);
    this.name = "OpenRouterUnavailableError";
  }
}

/** Maps an HTTP status from OpenRouter into the typed error above. `status` is the only thing trusted — never the body. */
export function errorForStatus(status: number): OpenRouterError {
  switch (status) {
    case 401:
      return new OpenRouterUnauthorizedError();
    case 402:
      return new OpenRouterInsufficientCreditsError();
    case 403:
      return new OpenRouterForbiddenError();
    case 408:
      return new OpenRouterTimeoutError("OpenRouter reported a request timeout (408)");
    case 429:
      return new OpenRouterRateLimitedError();
    case 502:
    case 503:
      return new OpenRouterUpstreamUnavailableError(status);
    default:
      return new OpenRouterError("http_error", `OpenRouter returned status ${status}`);
  }
}
