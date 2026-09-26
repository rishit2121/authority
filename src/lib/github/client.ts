import "server-only";

import { signAppJwt } from "./app-jwt";
import { GITHUB_WEB_ORIGIN, REQUEST_TIMEOUT_MS } from "./constants";
import { executionMode, liveConfig, type LiveConfig } from "./config";
import { GithubDefiniteError, GithubIndeterminateError, TransportError } from "./errors";
import { mockGithub } from "./mock";
import { ROUTES, type RouteRequest } from "./routes";
import {
  LiveGithubTransport,
  type GithubAuth,
  type GithubHttpResponse,
  type GithubTransport,
} from "./transport";

/** A credential that refuses to be serialized, logged or interpolated. */
export class SecretToken {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  reveal(): string {
    return this.#value;
  }
  toJSON(): string {
    return "[redacted]";
  }
  toString(): string {
    return "[redacted]";
  }
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "SecretToken([redacted])";
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Statuses returned to the caller instead of raised (e.g. 404 when probing for existence). */
  tolerate?: readonly number[];
}

export class GithubClient {
  constructor(
    private readonly transport: GithubTransport,
    private readonly appJwt: () => string,
    readonly mode: "mock" | "live",
  ) {}

  appAuth(): GithubAuth {
    return { kind: "app_jwt", token: this.appJwt() };
  }

  /** Classifies a response/failure into success, a definite failure, or an indeterminate write. */
  async request(req: RouteRequest, auth: GithubAuth, opts: RequestOptions = {}): Promise<GithubHttpResponse> {
    const mutating = ROUTES[req.route].mutating;
    let response: GithubHttpResponse;
    try {
      response = await this.transport.send(req, auth, { timeoutMs: REQUEST_TIMEOUT_MS, signal: opts.signal });
    } catch (error) {
      if (error instanceof TransportError) {
        if (error.kind === "redirect") throw new GithubDefiniteError("REDIRECT_REJECTED", 3);
        if (mutating) throw new GithubIndeterminateError(`TRANSPORT_${error.kind.toUpperCase()}`);
        throw new GithubDefiniteError(`TRANSPORT_${error.kind.toUpperCase()}`);
      }
      // A route-building violation or other local error happened before anything was sent.
      throw new GithubDefiniteError("REQUEST_REJECTED_LOCALLY");
    }
    const { status } = response;
    if (status >= 200 && status < 300) return response;
    if (opts.tolerate?.includes(status)) return response;
    if (status === 401) throw new GithubDefiniteError("AUTH_REJECTED", status);
    if (
      status === 429 ||
      (status === 403 && (response.rateLimitRemaining === 0 || response.retryAfterSeconds !== null))
    ) {
      throw new GithubDefiniteError("RATE_LIMITED", status);
    }
    if (status === 403) throw new GithubDefiniteError("FORBIDDEN", status);
    if (status === 404) throw new GithubDefiniteError("NOT_FOUND", status);
    if (status === 409) throw new GithubDefiniteError("CONFLICT", status);
    if (status === 422) throw new GithubDefiniteError("UNPROCESSABLE", status);
    if (status >= 500) {
      if (mutating) throw new GithubIndeterminateError(`UPSTREAM_${status}`, status);
      throw new GithubDefiniteError("UPSTREAM_ERROR", status);
    }
    throw new GithubDefiniteError("HTTP_ERROR", status);
  }

  /**
   * Mints a short-lived installation token restricted to ONE repository and
   * only the permissions the operation needs. The token lives in memory for the
   * duration of the call and is never persisted.
   */
  async mintInstallationToken(
    installationId: string,
    repositoryName: string,
    permissions: Record<string, "read" | "write">,
    opts: RequestOptions = {},
  ): Promise<SecretToken> {
    const response = await this.request(
      {
        route: "mintInstallationToken",
        params: { installationId },
        body: { repositories: [repositoryName], permissions },
      },
      this.appAuth(),
      opts,
    );
    const token = (response.body as { token?: unknown } | null)?.token;
    if (typeof token !== "string" || token.length < 10) throw new GithubDefiniteError("TOKEN_MINT_FAILED");
    return new SecretToken(token);
  }

  /** A metadata-read token for the whole installation, used only to list its repositories. */
  async mintDiscoveryToken(installationId: string, opts: RequestOptions = {}): Promise<SecretToken> {
    const response = await this.request(
      {
        route: "mintInstallationToken",
        params: { installationId },
        body: { permissions: { metadata: "read" } },
      },
      this.appAuth(),
      opts,
    );
    const token = (response.body as { token?: unknown } | null)?.token;
    if (typeof token !== "string" || token.length < 10) throw new GithubDefiniteError("TOKEN_MINT_FAILED");
    return new SecretToken(token);
  }

  installationAuth(token: SecretToken): GithubAuth {
    return { kind: "installation_token", token: token.reveal() };
  }
}

export function createGithubClient(): GithubClient {
  const mode = executionMode();
  if (mode === "mock") return new GithubClient(mockGithub(), () => "mock-app-jwt", "mock");
  if (mode === "live") {
    const cfg = liveConfig();
    if (!cfg) throw new GithubDefiniteError("CONNECTOR_NOT_CONFIGURED");
    return new GithubClient(
      new LiveGithubTransport(),
      () => signAppJwt({ issuer: cfg.clientId, privateKeyPem: cfg.privateKey }),
      "live",
    );
  }
  throw new GithubDefiniteError("CONNECTOR_DISABLED");
}

// ---------------------------------------------------------------------------
// OAuth (user-to-server) — used ONLY to prove a user can see an installation.
// The user token is held in memory for one callback and discarded.
// ---------------------------------------------------------------------------

export function oauthAuthorizeUrl(
  cfg: LiveConfig,
  redirectUri: string,
  state: string,
  codeChallenge: string,
): string {
  const url = new URL(`${GITHUB_WEB_ORIGIN}/login/oauth/authorize`);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeOAuthCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<SecretToken> {
  const mode = executionMode();
  if (mode === "mock") {
    if (!/^mockcode-[A-Za-z0-9]{1,40}$/.test(code)) throw new GithubDefiniteError("OAUTH_CODE_REJECTED");
    return new SecretToken(`ghu_mock_${code.slice(9)}`);
  }
  const cfg = liveConfig();
  if (mode !== "live" || !cfg) throw new GithubDefiniteError("CONNECTOR_NOT_CONFIGURED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${GITHUB_WEB_ORIGIN}/login/oauth/access_token`, {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "authority-github-connector",
      },
      body: JSON.stringify({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    if (response.status !== 200) throw new GithubDefiniteError("OAUTH_CODE_REJECTED", response.status);
    const text = await response.text();
    if (text.length > 16_384) throw new GithubDefiniteError("OAUTH_CODE_REJECTED");
    const token = (JSON.parse(text) as { access_token?: unknown }).access_token;
    if (typeof token !== "string" || token.length < 10) throw new GithubDefiniteError("OAUTH_CODE_REJECTED");
    return new SecretToken(token);
  } catch (error) {
    if (error instanceof GithubDefiniteError) throw error;
    throw new GithubDefiniteError("OAUTH_EXCHANGE_FAILED");
  } finally {
    clearTimeout(timer);
  }
}

/** Installation ids the user can see (pages capped: 5 x 100). */
export async function listUserInstallationIds(
  client: GithubClient,
  userToken: SecretToken,
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let page = 1; page <= 5; page++) {
    const response = await client.request(
      { route: "getUserInstallations", query: { per_page: 100, page } },
      { kind: "user_token", token: userToken.reveal() },
    );
    const body = response.body as { installations?: Array<{ id?: number }> } | null;
    const list = body?.installations ?? [];
    for (const i of list) if (typeof i.id === "number") ids.add(String(i.id));
    if (list.length < 100) break;
  }
  return ids;
}
