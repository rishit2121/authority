import "server-only";

import { readFileSync } from "node:fs";

/**
 * Deployment configuration for the GitHub connector. Everything secret here
 * (private key, client secret, webhook secret) comes from the server
 * environment or an ignored local file and is never written to the database,
 * a log, a response or the browser bundle.
 */

export type ExecutionMode = "mock" | "live" | "disabled";

export function executionMode(env: NodeJS.ProcessEnv = process.env): ExecutionMode {
  const raw = env.GITHUB_EXECUTION_MODE?.trim().toLowerCase();
  // The mock GitHub can never be active in production, whatever the variable says.
  if (raw === "mock") return env.NODE_ENV === "production" && env.AUTHORITY_ALLOW_MOCK_GITHUB !== "1" ? "disabled" : "mock";
  if (raw === "live") return "live";
  return "disabled";
}

export interface LiveConfig {
  appId: string;
  clientId: string;
  clientSecret: string;
  slug: string;
  privateKey: string;
  webhookSecret: string;
}

const LIVE_VARS = ["GITHUB_APP_ID", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_SLUG", "GITHUB_WEBHOOK_SECRET"] as const;

function loadPrivateKey(env: NodeJS.ProcessEnv): string | null {
  const inline = env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (inline) return inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
  const b64 = env.GITHUB_APP_PRIVATE_KEY_BASE64?.trim();
  if (b64) return Buffer.from(b64, "base64").toString("utf8");
  const file = env.GITHUB_APP_PRIVATE_KEY_FILE?.trim();
  if (file) {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  }
  return null;
}

/** Names of missing variables only — never values. */
export function missingLiveConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = LIVE_VARS.filter((name) => !env[name]?.trim());
  if (!loadPrivateKey(env)) missing.push("GITHUB_APP_PRIVATE_KEY (or _BASE64 / _FILE)");
  if (!publicBaseUrl(env)) missing.push("AUTHORITY_PUBLIC_URL");
  return missing;
}

export function liveConfig(env: NodeJS.ProcessEnv = process.env): LiveConfig | null {
  if (missingLiveConfig(env).length > 0) return null;
  return {
    appId: env.GITHUB_APP_ID!.trim(),
    clientId: env.GITHUB_APP_CLIENT_ID!.trim(),
    clientSecret: env.GITHUB_APP_CLIENT_SECRET!.trim(),
    slug: env.GITHUB_APP_SLUG!.trim(),
    privateKey: loadPrivateKey(env)!,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET!.trim(),
  };
}

export function publicBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.AUTHORITY_PUBLIC_URL?.trim() ?? (env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return null;
  }
}

export interface GithubReadiness {
  mode: ExecutionMode;
  ready: boolean;
  missing: string[];
}

export function githubReadiness(env: NodeJS.ProcessEnv = process.env): GithubReadiness {
  const mode = executionMode(env);
  if (mode === "disabled") return { mode, ready: false, missing: ["GITHUB_EXECUTION_MODE"] };
  if (mode === "mock") return { mode, ready: true, missing: [] };
  const missing = missingLiveConfig(env);
  return { mode, ready: missing.length === 0, missing };
}
