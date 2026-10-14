import "server-only";

/**
 * Operators of this Authority deployment (not workspace owners): the people
 * who may see cross-workspace usage metrics. Configured per deployment as a
 * comma-separated list of emails; empty means nobody.
 */
export function isPlatformAdmin(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!email) return false;
  const allowed = (env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}
