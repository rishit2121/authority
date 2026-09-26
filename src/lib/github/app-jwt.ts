import "server-only";

import { createSign } from "node:crypto";

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/**
 * GitHub App JSON Web Token: RS256, `iat` 60 s in the past (clock skew), `exp`
 * well under GitHub's 10-minute ceiling. Signed in memory per use; never stored.
 */
export function signAppJwt(input: { issuer: string; privateKeyPem: string; now?: Date }): string {
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 9 * 60, iss: input.issuer }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(input.privateKeyPem).toString("base64url")}`;
}
