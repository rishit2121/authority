import "server-only";

/** Where users can reach the operators of this deployment. Unset = no contact link is shown anywhere. */
export function supportEmail(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.SUPPORT_EMAIL?.trim();
  return value && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? value : null;
}
