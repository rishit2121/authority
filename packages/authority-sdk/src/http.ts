import { AuthorityApiError, AuthorityTimeoutError } from "./errors.js";

export interface RequestOptions {
  /** Caller's own cancellation signal, honored in addition to `timeoutMs`. */
  signal?: AbortSignal;
  /** Defaults to 15s. A tool-execution call may legitimately take longer than an authorize/list call -- pass a larger value for those specifically, never raise the default globally. */
  timeoutMs?: number;
}

/** The subset of the WHATWG `fetch` signature this SDK uses; inject one for tests or a custom transport. */
export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

export interface ClientConfig {
  baseUrl: string;
  token: string;
  defaultTimeoutMs?: number;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
}

interface ErrorBody {
  error?: { code?: string; message?: string; requestId?: string };
}

/**
 * Node 18 lacks `AbortSignal.any`; this is the one place that matters, so it's inlined rather than pulled in as a
 * dependency. `dispose` removes exactly the listeners it added (each signal's own handler is kept so it can be
 * removed), so a long-lived caller signal does not accumulate one listener per request.
 */
export function combineSignals(signals: readonly (AbortSignal | undefined)[]): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const attached: Array<{ signal: AbortSignal; listener: () => void }> = [];
  for (const s of signals) {
    if (s === undefined) continue;
    if (s.aborted) {
      controller.abort(s.reason);
      continue;
    }
    const listener = () => controller.abort(s.reason);
    s.addEventListener("abort", listener, { once: true });
    attached.push({ signal: s, listener });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const { signal, listener } of attached) signal.removeEventListener("abort", listener);
      attached.length = 0;
    },
  };
}

export interface ResponseWithMeta<T> {
  body: T;
  /** The `x-request-id` header (or the body's own `requestId`), when the server sent one. */
  requestId?: string;
  status: number;
}

/** Like `request`, but also returns the response's request id and HTTP status. */
export async function requestWithMeta<T>(
  config: ClientConfig,
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown },
  options: RequestOptions = {},
): Promise<ResponseWithMeta<T>> {
  const timeoutMs = options.timeoutMs ?? config.defaultTimeoutMs ?? 15_000;
  const timeoutController = new AbortController();
  const timer = setTimeout(
    () => timeoutController.abort(new Error(`timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  const { signal, dispose } = combineSignals([options.signal, timeoutController.signal]);
  const doFetch: FetchLike = config.fetch ?? ((input, requestInit) => fetch(input, requestInit));

  let response: Response;
  try {
    response = await doFetch(new URL(path, config.baseUrl), {
      method: init.method,
      headers: {
        authorization: `Bearer ${config.token}`,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      throw new AuthorityTimeoutError(undefined, options.signal?.aborted ? "aborted" : "timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    dispose();
  }

  const headerRequestId = response.headers.get("x-request-id") ?? undefined;
  const text = await response.text();
  let parsed: unknown = {};
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // A proxy error page, a truncated body, a wrong base URL: never surface a raw SyntaxError (or the body
      // itself, which may be anything) to the caller.
      throw new AuthorityApiError(`Authority returned a non-JSON response (HTTP ${response.status}).`, {
        status: response.status,
        code: "INVALID_RESPONSE",
        requestId: headerRequestId,
      });
    }
  }

  if (!response.ok) {
    const errorBody = (parsed ?? {}) as ErrorBody;
    throw new AuthorityApiError(errorBody.error?.message ?? `Request failed with status ${response.status}`, {
      status: response.status,
      code: errorBody.error?.code ?? "UNKNOWN_ERROR",
      requestId: errorBody.error?.requestId ?? headerRequestId,
      body: parsed,
    });
  }

  const bodyRequestId =
    parsed !== null &&
    typeof parsed === "object" &&
    typeof (parsed as { requestId?: unknown }).requestId === "string"
      ? (parsed as { requestId: string }).requestId
      : undefined;
  return { body: parsed as T, requestId: headerRequestId ?? bodyRequestId, status: response.status };
}

export async function request<T>(
  config: ClientConfig,
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown },
  options: RequestOptions = {},
): Promise<T> {
  return (await requestWithMeta<T>(config, path, init, options)).body;
}
