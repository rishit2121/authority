import "server-only";

import { createHash, randomBytes } from "node:crypto";

import {
  applyRepositorySnapshot,
  applyWebhook,
  beginInstall,
  completeInstall,
  disconnectInstallation,
  rejectInstall,
  reportInstall,
  reportedInstallation,
  updateInstallationHealth,
  type InstallationFacts,
  type RepositorySnapshotEntry,
} from "@/lib/gateway/rpc-github";
import { safeLog } from "@/lib/semantic/scrub";

import {
  createGithubClient,
  exchangeOAuthCode,
  listUserInstallationIds,
  oauthAuthorizeUrl,
  type GithubClient,
} from "./client";
import { executionMode, liveConfig, publicBaseUrl } from "./config";
import { EXPECTED_PERMISSIONS, GITHUB_WEB_ORIGIN } from "./constants";
import { GithubDefiniteError } from "./errors";
import { parseWebhook, verifyWebhookSignature } from "./webhook";

/**
 * GitHub App installation lifecycle: connect (state-bound, OAuth-verified),
 * repository discovery, health / permission-drift checks, webhook effects and
 * disconnect. No key, token or secret is persisted here — installation tokens
 * and user tokens live in local variables for a single call.
 */

export const STATE_COOKIE = "authority_gh_state";
export const PKCE_COOKIE = "authority_gh_pkce";
export const COOKIE_MAX_AGE_SECONDS = 15 * 60;

const sha256hex = (v: string) => createHash("sha256").update(v).digest("hex");
const b64url = (b: Buffer) => b.toString("base64url");
const NONCE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function nonceHash(nonce: string): string {
  return sha256hex(nonce);
}

export interface StartedInstall {
  installUrl: string;
  nonce: string;
  verifier: string;
}

export async function startInstall(input: {
  tenantId: string;
  userId: string;
  /** The App is already installed: skip GitHub's install page and go straight to the identity check. */
  existing?: boolean;
}): Promise<{ status: string; started?: StartedInstall }> {
  const mode = executionMode();
  if (mode === "disabled") return { status: "connector_disabled" };
  const base = publicBaseUrl();
  if (!base) return { status: "not_configured" };
  const cfg = mode === "live" ? liveConfig() : null;
  if (mode === "live" && !cfg) return { status: "not_configured" };

  const nonce = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(48));
  const r = await beginInstall({
    tenantId: input.tenantId,
    userId: input.userId,
    nonceHash: nonceHash(nonce),
  });
  if (r.status !== "ok") return { status: r.status };

  if (input.existing) {
    // No installation id is claimed by anyone here: after GitHub authenticates the user, the id is taken
    // from GitHub's own list of installations that user can see (see handleOAuthCallback).
    const installUrl =
      mode === "live"
        ? oauthAuthorizeUrl(
            cfg!,
            callbackUrl(base),
            nonce,
            b64url(createHash("sha256").update(verifier).digest()),
          )
        : `${callbackUrl(base)}?code=mockcode-verified&state=${nonce}`;
    return { status: "ok", started: { installUrl, nonce, verifier } };
  }

  const installUrl =
    mode === "live"
      ? `${GITHUB_WEB_ORIGIN}/apps/${encodeURIComponent(cfg!.slug)}/installations/new?state=${nonce}`
      : `${base}/api/github/setup?installation_id=9001&setup_action=install&state=${nonce}`;
  return { status: "ok", started: { installUrl, nonce, verifier } };
}

function callbackUrl(base: string): string {
  return `${base}/api/github/oauth/callback`;
}

export type SetupOutcome = { kind: "redirect"; url: string } | { kind: "error"; code: string };

/**
 * GitHub sent the browser back with an installation id. The id is only a CLAIM
 * (anyone can craft this URL), so it is bound to the cookie-held nonce and
 * then verified through GitHub's OAuth flow before anything is mapped.
 */
export async function handleSetupCallback(input: {
  tenantId: string;
  userId: string;
  cookieNonce: string | undefined;
  cookieVerifier: string | undefined;
  urlState: string | null;
  installationId: string | null;
}): Promise<SetupOutcome> {
  const base = publicBaseUrl();
  if (!base) return { kind: "error", code: "not_configured" };
  // No state cookie at all: GitHub sent the user back without Authority having started the flow in this
  // browser (typically the App was installed directly from GitHub). Nothing is mapped; the user is told to start here.
  if (!input.cookieNonce) return { kind: "error", code: "not_started_here" };
  if (!NONCE_SHAPE.test(input.cookieNonce)) return { kind: "error", code: "invalid_state" };
  if (input.urlState !== null && input.urlState !== input.cookieNonce)
    return { kind: "error", code: "invalid_state" };
  if (!input.installationId || !/^[0-9]{1,15}$/.test(input.installationId))
    return { kind: "error", code: "invalid_installation" };

  const status = await reportInstall({
    tenantId: input.tenantId,
    userId: input.userId,
    nonceHash: nonceHash(input.cookieNonce),
    installationId: input.installationId,
  });
  if (status !== "ok") return { kind: "error", code: status };

  if (executionMode() === "mock") {
    return {
      kind: "redirect",
      url: `${callbackUrl(base)}?code=mockcode-verified&state=${input.cookieNonce}`,
    };
  }
  const cfg = liveConfig();
  if (!cfg || !input.cookieVerifier) return { kind: "error", code: "not_configured" };
  const challenge = b64url(createHash("sha256").update(input.cookieVerifier).digest());
  return { kind: "redirect", url: oauthAuthorizeUrl(cfg, callbackUrl(base), input.cookieNonce, challenge) };
}

const mapPermissions = (raw: unknown): Record<string, string> =>
  raw && typeof raw === "object"
    ? Object.fromEntries(
        Object.entries(raw).filter(([, v]) => typeof v === "string") as Array<[string, string]>,
      )
    : {};

async function fetchInstallationFacts(
  client: GithubClient,
  installationId: string,
): Promise<{ facts: InstallationFacts; suspended: boolean }> {
  const r = await client.request({ route: "getInstallation", params: { installationId } }, client.appAuth());
  const b = r.body as {
    id?: number;
    account?: { login?: string; type?: string; id?: number };
    repository_selection?: string;
    permissions?: unknown;
    events?: unknown;
    suspended_at?: string | null;
  } | null;
  if (!b || String(b.id) !== installationId || !b.account?.login || !b.account.id)
    throw new GithubDefiniteError("INSTALLATION_INVALID");
  if (b.account.type !== "User" && b.account.type !== "Organization")
    throw new GithubDefiniteError("INSTALLATION_INVALID");
  if (b.repository_selection !== "all" && b.repository_selection !== "selected")
    throw new GithubDefiniteError("INSTALLATION_INVALID");
  return {
    suspended: Boolean(b.suspended_at),
    facts: {
      installationId,
      accountLogin: b.account.login,
      accountType: b.account.type,
      accountId: String(b.account.id),
      repositorySelection: b.repository_selection,
      permissions: mapPermissions(b.permissions),
      events: Array.isArray(b.events)
        ? b.events.filter((e): e is string => typeof e === "string").slice(0, 32)
        : [],
    },
  };
}

/** Repositories visible to the installation, via a metadata-only token discarded on return. */
export async function discoverRepositories(
  client: GithubClient,
  installationId: string,
): Promise<RepositorySnapshotEntry[]> {
  const token = await client.mintDiscoveryToken(installationId);
  const out: RepositorySnapshotEntry[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await client.request(
      { route: "listInstallationRepositories", query: { per_page: 100, page } },
      client.installationAuth(token),
    );
    const list = (r.body as { repositories?: Array<Record<string, unknown>> } | null)?.repositories ?? [];
    for (const repo of list) {
      const owner = (repo.owner as { login?: string } | undefined)?.login;
      if (
        typeof repo.id === "number" &&
        typeof owner === "string" &&
        typeof repo.name === "string" &&
        typeof repo.default_branch === "string"
      ) {
        out.push({
          id: repo.id,
          owner,
          name: repo.name,
          defaultBranch: repo.default_branch,
          private: Boolean(repo.private),
          archived: Boolean(repo.archived),
        });
      }
    }
    if (list.length < 100) break;
  }
  return out;
}

export type OAuthOutcome =
  { ok: true; installationRowId: string; health: string } | { ok: false; code: string };

export async function handleOAuthCallback(input: {
  tenantId: string;
  userId: string;
  cookieNonce: string | undefined;
  cookieVerifier: string | undefined;
  state: string | null;
  code: string | null;
}): Promise<OAuthOutcome> {
  const base = publicBaseUrl();
  if (!base) return { ok: false, code: "not_configured" };
  if (!input.cookieNonce || !NONCE_SHAPE.test(input.cookieNonce) || input.state !== input.cookieNonce)
    return { ok: false, code: "invalid_state" };
  if (!input.code || input.code.length > 200) return { ok: false, code: "invalid_code" };
  const hash = nonceHash(input.cookieNonce);
  const scope = { tenantId: input.tenantId, userId: input.userId, nonceHash: hash };

  let reported = await reportedInstallation(scope);

  try {
    const client = createGithubClient();
    const userToken = await exchangeOAuthCode(input.code, callbackUrl(base), input.cookieVerifier ?? "");
    const visible = await listUserInstallationIds(client, userToken);
    if (!reported) {
      // The "I already installed the App" path: nothing was claimed by a redirect. Only an installation GitHub
      // itself lists for this authenticated user can be connected, and only when it is unambiguous.
      if (visible.size !== 1) {
        await rejectInstall({
          ...scope,
          reason: visible.size === 0 ? "NO_INSTALLATION_VISIBLE" : "MULTIPLE_INSTALLATIONS",
        });
        return { ok: false, code: visible.size === 0 ? "no_installation_visible" : "multiple_installations" };
      }
      const only = [...visible][0];
      const status = await reportInstall({ ...scope, installationId: only });
      if (status !== "ok") return { ok: false, code: status === "invalid_state" ? "invalid_state" : status };
      reported = only;
    }
    // The reported id must be one THIS GitHub user can actually see: substituting another id fails here.
    if (!visible.has(reported)) {
      await rejectInstall({ ...scope, reason: "INSTALLATION_NOT_VISIBLE_TO_USER" });
      return { ok: false, code: "installation_not_visible" };
    }
    const { facts } = await fetchInstallationFacts(client, reported);
    const done = await completeInstall({
      ...scope,
      facts,
      expectedPermissions: { ...EXPECTED_PERMISSIONS },
      mode: client.mode,
    });
    if (done.status !== "ok" || !done.installationRowId) return { ok: false, code: done.status };

    try {
      const repos = await discoverRepositories(client, reported);
      await applyRepositorySnapshot({
        tenantId: input.tenantId,
        actorUserId: input.userId,
        installationRowId: done.installationRowId,
        repositories: repos,
      });
    } catch {
      safeLog(
        "github install: repository discovery failed (installation connected; retry from the setup page)",
      );
    }
    return { ok: true, installationRowId: done.installationRowId, health: done.health ?? "active" };
  } catch (error) {
    await rejectInstall({ ...scope, reason: "VERIFICATION_FAILED" }).catch(() => undefined);
    return {
      ok: false,
      code: error instanceof GithubDefiniteError ? error.code.toLowerCase() : "verification_failed",
    };
  }
}

/** Re-reads the installation from GitHub: permission drift, suspension, repository set. */
export async function refreshInstallation(input: {
  tenantId: string;
  userId: string | null;
  installationRowId: string;
  githubInstallationId: string;
}): Promise<{ status: string; health: string | null; reasons: string[] }> {
  const client = createGithubClient();
  let facts: InstallationFacts;
  let suspended: boolean;
  try {
    ({ facts, suspended } = await fetchInstallationFacts(client, input.githubInstallationId));
  } catch (error) {
    // GitHub says the installation is gone: mark it drifted rather than trusting stale health.
    if (error instanceof GithubDefiniteError && error.code === "NOT_FOUND") {
      return updateInstallationHealth({
        githubInstallationId: input.githubInstallationId,
        actorUserId: input.userId,
        selection: "selected",
        permissions: {},
        events: [],
        suspended: false,
        expectedPermissions: { ...EXPECTED_PERMISSIONS },
      });
    }
    throw error;
  }
  const health = await updateInstallationHealth({
    githubInstallationId: input.githubInstallationId,
    actorUserId: input.userId,
    selection: facts.repositorySelection,
    permissions: facts.permissions,
    events: facts.events,
    suspended,
    expectedPermissions: { ...EXPECTED_PERMISSIONS },
  });
  if (health.health === "active") {
    const repos = await discoverRepositories(client, input.githubInstallationId);
    await applyRepositorySnapshot({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      installationRowId: input.installationRowId,
      repositories: repos,
    });
  }
  return health;
}

export async function disconnect(input: {
  tenantId: string;
  userId: string;
  installationRowId: string;
  alsoUninstall: boolean;
}): Promise<{ status: string; revokedCapabilities: number; uninstalled: boolean | null }> {
  const r = await disconnectInstallation(input);
  if (r.status !== "ok") return { status: r.status, revokedCapabilities: 0, uninstalled: null };
  let uninstalled: boolean | null = null;
  if (input.alsoUninstall && r.githubInstallationId) {
    try {
      const client = createGithubClient();
      await client.request(
        { route: "deleteInstallation", params: { installationId: r.githubInstallationId } },
        client.appAuth(),
      );
      uninstalled = true;
    } catch {
      // Local revocation already happened and is what matters; the owner can uninstall on GitHub.
      uninstalled = false;
    }
  }
  return { status: "ok", revokedCapabilities: r.revoked, uninstalled };
}

export function webhookSecret(): string | null {
  const mode = executionMode();
  if (mode === "live") return liveConfig()?.webhookSecret ?? null;
  if (mode === "mock") return process.env.GITHUB_WEBHOOK_SECRET?.trim() || "mock-webhook-secret";
  return null;
}

export interface WebhookOutcome {
  http: number;
  body: Record<string, unknown>;
}

export async function processWebhook(input: {
  rawBody: string;
  signature: string | null;
  event: string | null;
  deliveryId: string | null;
}): Promise<WebhookOutcome> {
  const secret = webhookSecret();
  if (!secret) return { http: 503, body: { error: "not_configured" } };
  if (!verifyWebhookSignature(secret, input.rawBody, input.signature))
    return { http: 401, body: { error: "invalid_signature" } };
  if (!input.event || !input.deliveryId || !/^[A-Za-z0-9-]{8,80}$/.test(input.deliveryId))
    return { http: 400, body: { error: "invalid_headers" } };
  if (input.event === "ping") return { http: 200, body: { status: "pong" } };
  if (input.event !== "installation" && input.event !== "installation_repositories") {
    return { http: 200, body: { status: "ignored" } };
  }
  const parsed = parseWebhook(input.event, input.rawBody);
  if (!parsed || !parsed.installationId) return { http: 400, body: { error: "invalid_payload" } };

  const outcome = await applyWebhook({
    deliveryId: input.deliveryId,
    event: parsed.event,
    action: parsed.action,
    githubInstallationId: parsed.installationId,
    removedRepositoryIds: parsed.removedRepositoryIds,
  });
  return { http: 200, body: { status: outcome } };
}
