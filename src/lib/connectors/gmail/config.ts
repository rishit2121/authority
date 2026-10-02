import "server-only";

/**
 * Deployment configuration for the Gmail connector's OAuth client. Both
 * values come from the server environment only and are never written to the
 * database, a log, a response, or the browser bundle -- same rule as
 * src/lib/github/config.ts's own `LiveConfig`.
 */
export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

const LIVE_VARS = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"] as const;

export function missingGoogleOAuthConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  return LIVE_VARS.filter((k) => !env[k]?.trim());
}

export function googleOAuthConfig(env: NodeJS.ProcessEnv = process.env): GoogleOAuthConfig | null {
  if (missingGoogleOAuthConfig(env).length > 0) return null;
  return {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID!.trim(),
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET!.trim(),
  };
}
