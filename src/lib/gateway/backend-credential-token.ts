import "server-only";

/**
 * Developer backend credential tokens: "authority_dk_" + 64 lowercase-hex
 * characters, the same shape as agent_credentials' "authority_rk_" secret,
 * minted by `public.create_backend_credential()`
 * (20261003000002_developer_backend_credentials.sql). Deliberately its own
 * prefix and its own resolver (gateway.resolve_backend_credential) rather
 * than a variant of the agent runtime key -- see that migration's own
 * comment for why these two credential spaces must never overlap.
 */
export const BACKEND_CREDENTIAL_PREFIX = "authority_dk_";

const SECRET_BODY_LENGTH = 64;

export function isWellFormedBackendCredential(secret: string): boolean {
  if (!secret.startsWith(BACKEND_CREDENTIAL_PREFIX)) return false;
  const body = secret.slice(BACKEND_CREDENTIAL_PREFIX.length);
  return body.length === SECRET_BODY_LENGTH && /^[0-9a-f]+$/.test(body);
}
