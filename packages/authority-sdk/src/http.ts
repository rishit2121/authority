import { AuthorityApiError, AuthorityTimeoutError } from "./errors.js";

export interface RequestOptions {
  /** Caller's own cancellation signal, honored in addition to `timeoutMs`. */
  signal?: AbortSignal;
  /** Defaults to 15s. A tool-execution call may legitimately take longer than an authorize/list call -- pass a larger value for those specifically, never raise the default globally. */
  timeoutMs?: number;
}

export interface ClientConfig {
  baseUrl: string;
  token: string;
  defaultTimeoutMs?: number;
}

interface ErrorBody {
  error?: { code?: string; message?: string; requestId?: string };
}

/** Node 18 lacks `AbortSignal.any`; this is the one place that matters, so it's inlined rather than pulled in as a dependency. */
function combineSignals(signals: readonly (AbortSignal | undefined)[]): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const present = signals.filter((s): s is AbortSignal => s !== undefined);
  const onAbort = (s: AbortSignal) => controller.abort(s.reason);
  for (const s of present) {
    if (s.aborted) controller.abort(s.reason);
    else s.addEventListener("abort", () => onAbort(s), { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const s of present) s.removeEventListener("abort", () => onAbort(s));
    },
  };
}

export async function request<T>(
  config: ClientConfig,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
  options: RequestOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? config.defaultTimeoutMs ?? 15_000;
  const timeoutController = new AbortController();
  const timer = setTimeout(
    () => timeoutController.abort(new Error(`timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  const { signal, dispose } = combineSignals([options.signal, timeoutController.signal]);

  let response: Response;
  try {
    response = await fetch(new URL(path, config.baseUrl), {
      method: init.method,
      headers: {
        authorization: `Bearer ${config.token}`,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw new AuthorityTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    dispose();
  }

  const requestId = response.headers.get("x-request-id") ?? undefined;
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : {};

  if (!response.ok) {
    const errorBody = parsed as ErrorBody;
    throw new AuthorityApiError(errorBody.error?.message ?? `Request failed with status ${response.status}`, {
      status: response.status,
      code: errorBody.error?.code ?? "UNKNOWN_ERROR",
      requestId: errorBody.error?.requestId ?? requestId,
      body: parsed,
    });
  }

  return parsed as T;
}
