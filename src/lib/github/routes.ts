import { GITHUB_API_ORIGIN } from "./constants";

/**
 * The COMPLETE set of GitHub REST calls the connector can make. Each entry is
 * one fixed method and one fixed path template. There is no way to express a
 * raw URL, method or path: callers name a RouteId and supply typed parameters,
 * and the URL is assembled here from validated, individually-encoded pieces.
 */

export type RouteId =
  | "mintInstallationToken"
  | "getInstallation"
  | "deleteInstallation"
  | "listInstallationRepositories"
  | "getRepository"
  | "getIssue"
  | "getContents"
  | "getBranch"
  | "getRef"
  | "createRef"
  | "putContents"
  | "listPulls"
  | "createPull"
  | "getPull"
  | "getUserInstallations";

export type AuthKind = "app_jwt" | "installation_token" | "user_token";

interface RouteDef {
  method: "GET" | "POST" | "PUT" | "DELETE";
  auth: AuthKind;
  mutating: boolean;
  /** Path segments: literal strings or `:param` placeholders. */
  segments: string[];
  query?: readonly string[];
}

export const ROUTES: Readonly<Record<RouteId, RouteDef>> = Object.freeze({
  mintInstallationToken: {
    method: "POST",
    auth: "app_jwt",
    mutating: false,
    segments: ["app", "installations", ":installationId", "access_tokens"],
  },
  getInstallation: {
    method: "GET",
    auth: "app_jwt",
    mutating: false,
    segments: ["app", "installations", ":installationId"],
  },
  deleteInstallation: {
    method: "DELETE",
    auth: "app_jwt",
    mutating: true,
    segments: ["app", "installations", ":installationId"],
  },
  listInstallationRepositories: {
    method: "GET",
    auth: "installation_token",
    mutating: false,
    segments: ["installation", "repositories"],
    query: ["per_page", "page"],
  },
  getRepository: {
    method: "GET",
    auth: "installation_token",
    mutating: false,
    segments: ["repos", ":owner", ":repo"],
  },
  getIssue: {
    method: "GET",
    auth: "installation_token",
    mutating: false,
    segments: ["repos", ":owner", ":repo", "issues", ":number"],
  },
  getContents: {
    method: "GET",
    auth: "installation_token",
    mutating: false,
    segments: ["repos", ":owner", ":repo", "contents", ":path*"],
    query: ["ref"],
  },
  getBranch: {
    method: "GET",
    auth: "installation_token",
    mutating: false,
    segments: ["repos", ":owner", ":repo", "branches", ":branch*"],
  },
  getRef: {
    method: "GET",
    auth: "installation_token",
    mutating: false,
    segments: ["repos", ":owner", ":repo", "git", "ref", "heads", ":branch*"],
  },
  createRef: {
    method: "POST",
    auth: "installation_token",
    mutating: true,
    segments: ["repos", ":owner", ":repo", "git", "refs"],
  },
  putContents: {
    method: "PUT",
    auth: "installation_token",
    mutating: true,
    segments: ["repos", ":owner", ":repo", "contents", ":path*"],
  },
  listPulls: {
    method: "GET",
    auth: "installation_token",
    mutating: false,
    segments: ["repos", ":owner", ":repo", "pulls"],
    query: ["head", "base", "state", "per_page"],
  },
  createPull: {
    method: "POST",
    auth: "installation_token",
    mutating: true,
    segments: ["repos", ":owner", ":repo", "pulls"],
  },
  getPull: {
    method: "GET",
    auth: "installation_token",
    mutating: false,
    segments: ["repos", ":owner", ":repo", "pulls", ":number"],
  },
  getUserInstallations: {
    method: "GET",
    auth: "user_token",
    mutating: false,
    segments: ["user", "installations"],
    query: ["per_page", "page"],
  },
});

export interface RouteRequest {
  route: RouteId;
  params?: Record<string, string | number>;
  query?: Record<string, string | number>;
  body?: Record<string, unknown>;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._@+=,-]{1,100}$/;

export class RouteBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteBuildError";
  }
}

/** Builds and re-verifies the final URL. Throws RouteBuildError on anything unexpected. */
export function buildUrl(req: RouteRequest): {
  url: URL;
  method: RouteDef["method"];
  auth: AuthKind;
  mutating: boolean;
} {
  const def = ROUTES[req.route];
  if (!def) throw new RouteBuildError("unknown route");
  const parts: string[] = [];
  for (const seg of def.segments) {
    if (!seg.startsWith(":")) {
      parts.push(seg);
      continue;
    }
    const multi = seg.endsWith("*");
    const name = seg.slice(1, multi ? -1 : undefined);
    const raw = req.params?.[name];
    if (raw === undefined) throw new RouteBuildError(`missing route parameter ${name}`);
    const text = String(raw);
    const pieces = multi ? text.split("/") : [text];
    for (const piece of pieces) {
      if (!SAFE_SEGMENT.test(piece) || piece === "." || piece === "..")
        throw new RouteBuildError(`unsafe route parameter ${name}`);
      parts.push(encodeURIComponent(piece));
    }
  }
  const url = new URL(`${GITHUB_API_ORIGIN}/${parts.join("/")}`);
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (!def.query?.includes(k)) throw new RouteBuildError(`query parameter ${k} not allowed`);
    url.searchParams.set(k, String(v));
  }
  if (url.origin !== GITHUB_API_ORIGIN || url.protocol !== "https:")
    throw new RouteBuildError("egress origin violation");
  return { url, method: def.method, auth: def.auth, mutating: def.mutating };
}
