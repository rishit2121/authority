/**
 * Defense in depth for anything that might be logged or returned: remove the
 * literal value of every secret this process is configured with. The real
 * protection is that secrets are never put into messages in the first place;
 * this catches a mistake.
 */
const SECRET_ENV_NAMES = [
  "SEMANTIC_PROVIDER_API_KEY",
  "SEMANTIC_PROVIDER_API_KEY_SECONDARY",
  "GATEWAY_DATABASE_URL",
  "GATEWAY_DATABASE_CA",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_PRIVATE_KEY_BASE64",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_WEBHOOK_SECRET",
] as const;

function secretValues(env: Record<string, string | undefined>): string[] {
  const values = new Set<string>();
  for (const name of SECRET_ENV_NAMES) {
    const v = env[name]?.trim();
    if (v && v.length >= 8) values.add(v);
    if (name === "GATEWAY_DATABASE_URL" && v) {
      try {
        const password = decodeURIComponent(new URL(v).password);
        if (password.length >= 8) values.add(password);
      } catch {
        /* not a URL */
      }
    }
  }
  return [...values];
}

export function scrubKnownSecrets(
  text: string,
  env: Record<string, string | undefined> = process.env,
): string {
  let out = text;
  for (const secret of secretValues(env)) out = out.split(secret).join("[REDACTED]");
  // Bearer material and runtime/capability tokens, whatever their source.
  return out
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g, "[REDACTED]")
    .replace(/\bauthority_rk_[0-9a-f]{16,}\b/g, "[REDACTED]")
    .replace(/\bauthcap_v1_[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, "Bearer [REDACTED]");
}

export function safeLog(message: string): void {
  console.error(scrubKnownSecrets(message));
}
