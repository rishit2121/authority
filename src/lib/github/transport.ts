import { GITHUB_API_VERSION, MAX_RESPONSE_BYTES } from "./constants";
import { TransportError } from "./errors";
import { buildUrl, type RouteRequest } from "./routes";

export interface GithubHttpResponse {
  status: number;
  requestId: string | null;
  rateLimitRemaining: number | null;
  retryAfterSeconds: number | null;
  body: unknown;
}

export interface GithubAuth {
  kind: "app_jwt" | "installation_token" | "user_token";
  /** Held in memory only. Never logged, stored or returned. */
  token: string;
}

export interface GithubTransport {
  send(
    req: RouteRequest,
    auth: GithubAuth,
    opts: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<GithubHttpResponse>;
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new TransportError("too_large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new TransportError("too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The only code that talks to GitHub. Egress guarantees enforced here:
 *  - the URL comes from a fixed route table on api.github.com over HTTPS;
 *  - redirects are NEVER followed (a 3xx is surfaced as a `redirect` error);
 *  - hard per-request timeout; response body size capped while streaming;
 *  - the credential is attached here and nowhere else.
 */
export class LiveGithubTransport implements GithubTransport {
  async send(
    req: RouteRequest,
    auth: GithubAuth,
    opts: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<GithubHttpResponse> {
    const { url, method, auth: required } = buildUrl(req);
    if (required !== auth.kind) throw new TransportError("aborted");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    opts.signal?.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      const response = await fetch(url, {
        method,
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${auth.token}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
          "User-Agent": "authority-github-connector",
          ...(req.body ? { "Content-Type": "application/json" } : {}),
        },
        body: req.body ? JSON.stringify(req.body) : undefined,
      });
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel();
        throw new TransportError("redirect");
      }
      const text = await readCapped(response);
      let body: unknown = null;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new TransportError("bad_json");
        }
      }
      const remaining = response.headers.get("x-ratelimit-remaining");
      const retry = response.headers.get("retry-after");
      return {
        status: response.status,
        requestId: response.headers.get("x-github-request-id"),
        rateLimitRemaining: remaining === null ? null : Number(remaining),
        retryAfterSeconds: retry === null ? null : Number(retry),
        body,
      };
    } catch (error) {
      if (error instanceof TransportError) throw error;
      if (controller.signal.aborted) throw new TransportError(opts.signal?.aborted ? "aborted" : "timeout");
      throw new TransportError("network");
    } finally {
      clearTimeout(timer);
    }
  }
}
