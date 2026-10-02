import "server-only";

/**
 * This deployment's own public origin, for building an OAuth redirect URI
 * that must exactly match what the provider's app configuration expects.
 * Identical logic to src/lib/github/config.ts's own `publicBaseUrl` --
 * duplicated rather than imported so connector modules stay independent of
 * one another, not because the two should ever diverge.
 */
export function publicBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw =
    env.AUTHORITY_PUBLIC_URL?.trim() ||
    env.RENDER_EXTERNAL_URL?.trim() ||
    (env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return null;
  }
}
