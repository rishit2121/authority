import "server-only";

/**
 * This deployment's own public origin, for building an OAuth redirect URI
 * that must exactly match what the provider's app configuration expects.
 * Identical logic to src/lib/github/config.ts's own `publicBaseUrl` --
 * duplicated rather than imported so connector modules stay independent of
 * one another, not because the two should ever diverge.
 *
 * The `http://localhost:3000` development fallback is a convenience for
 * Authority's own default (`npm run dev` binds port 3000), not a guess at
 * the inbound request's actual origin -- deliberately not derived from a
 * request's Host header, which would make an OAuth redirect URI depend on
 * caller-supplied input. Running dev on any other port requires setting
 * `AUTHORITY_PUBLIC_URL` explicitly in that server's own environment, or
 * the embedded connect flow's redirect will target the wrong origin.
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
