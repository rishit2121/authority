import { createVerify, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { signAppJwt } from "@/lib/github/app-jwt";
import { githubReadiness, executionMode, missingLiveConfig, publicBaseUrl } from "@/lib/github/config";
import { redactText, redactValue } from "@/lib/github/redact";
import { parseWebhook, verifyWebhookSignature } from "@/lib/github/webhook";
import { SecretToken } from "@/lib/github/client";

describe("webhook signature (X-Hub-Signature-256)", () => {
  // Test vector from GitHub's "Validating webhook deliveries" documentation.
  const secret = "It's a Secret to Everybody";
  const payload = "Hello, World!";
  const good = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

  it("accepts the documented vector", () => {
    expect(verifyWebhookSignature(secret, payload, good)).toBe(true);
  });

  it("rejects tampering, wrong secrets, bad formats and empty inputs", () => {
    expect(verifyWebhookSignature(secret, payload + "!", good)).toBe(false);
    expect(verifyWebhookSignature("other", payload, good)).toBe(false);
    for (const h of [null, "", "sha256=", "sha1=757107ea0eb2509fc211221cce984b8a37570b6d", good.toUpperCase(), good.slice(0, -2), `${good}00`, "757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17"]) {
      expect(verifyWebhookSignature(secret, payload, h), String(h)).toBe(false);
    }
    expect(verifyWebhookSignature("", payload, good)).toBe(false);
  });
});

describe("webhook payload parsing", () => {
  it("extracts only the fields it acts on", () => {
    const body = JSON.stringify({ action: "removed", installation: { id: 9001 }, repositories_removed: [{ id: 5 }, { id: "x" }, { id: -1 }], sender: { login: "x" } });
    expect(parseWebhook("installation_repositories", body)).toEqual({ event: "installation_repositories", action: "removed", installationId: "9001", removedRepositoryIds: [5] });
    expect(parseWebhook("installation", "not json")).toBeNull();
    expect(parseWebhook("installation", '{"action":"a b","installation":{"id":"9"}}')).toMatchObject({ action: null, installationId: null });
  });
});

describe("redaction", () => {
  it("scrubs token- and key-shaped text and counts what it removed", () => {
    const counts: Record<string, number> = {};
    const out = redactText(
      "a ghp_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6 b ghs_0123456789abcdefghij0123456789 c github_pat_11ABCDEFG0123456789_abcdefghijklmnop d Bearer abcdefghijklmnopqrstuvwx e -----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----",
      counts,
    );
    expect(out).not.toMatch(/ghp_|ghs_|github_pat_|MIIB|abcdefghijklmnopqrstuvwx/);
    expect(counts).toMatchObject({ github_token: 2, github_pat: 1, bearer: 1, private_key: 1 });
  });

  it("redacts deeply and leaves ordinary text alone", () => {
    const v = redactValue({ a: ["x ghp_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6"], b: { c: "plain text", n: 3 } });
    expect(JSON.stringify(v)).not.toContain("ghp_");
    expect(v.b).toEqual({ c: "plain text", n: 3 });
  });
});

describe("SecretToken", () => {
  it("cannot be serialized, interpolated or inspected", () => {
    const t = new SecretToken("ghs_supersecretvalue0123456789");
    expect(JSON.stringify({ t })).not.toContain("supersecret");
    expect(`${t}`).toBe("[redacted]");
    expect(String(t)).toBe("[redacted]");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(require("node:util").inspect(t)).not.toContain("supersecret");
    expect(t.reveal()).toContain("supersecret");
  });
});

describe("App JWT", () => {
  it("is RS256 with a short lifetime and verifies against the public key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const now = new Date("2026-09-30T12:00:00Z");
    const jwt = signAppJwt({ issuer: "Iv1.client", privateKeyPem: pem, now });
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    const sec = Math.floor(now.getTime() / 1000);
    expect(claims).toEqual({ iat: sec - 60, exp: sec + 540, iss: "Iv1.client" });
    expect(claims.exp - sec).toBeLessThan(600);
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${p}`);
    expect(v.verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });
});

describe("connector configuration fails closed", () => {
  it("is disabled unless explicitly mock or live, and mock never runs in production", () => {
    expect(executionMode({} as NodeJS.ProcessEnv)).toBe("disabled");
    expect(executionMode({ GITHUB_EXECUTION_MODE: "yes" } as never)).toBe("disabled");
    expect(executionMode({ GITHUB_EXECUTION_MODE: "mock", NODE_ENV: "development" } as never)).toBe("mock");
    expect(executionMode({ GITHUB_EXECUTION_MODE: "mock", NODE_ENV: "production" } as never)).toBe("disabled");
    expect(executionMode({ GITHUB_EXECUTION_MODE: "live" } as never)).toBe("live");
  });

  it("reports only the NAMES of missing live variables", () => {
    const env = { GITHUB_EXECUTION_MODE: "live", NODE_ENV: "production", GITHUB_APP_ID: "1" } as unknown as NodeJS.ProcessEnv;
    const r = githubReadiness(env);
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining(["GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_SLUG", "GITHUB_WEBHOOK_SECRET", "AUTHORITY_PUBLIC_URL"]));
    expect(JSON.stringify(r)).not.toContain('"1"');
    expect(missingLiveConfig({ ...env, GITHUB_APP_PRIVATE_KEY: "-----BEGIN-----" } as never)).not.toContain("GITHUB_APP_PRIVATE_KEY (or _BASE64 / _FILE)");
  });

  it("requires an explicit public URL in production", () => {
    expect(publicBaseUrl({ NODE_ENV: "production" } as never)).toBeNull();
    expect(publicBaseUrl({ NODE_ENV: "production", AUTHORITY_PUBLIC_URL: "https://app.example.com/x?y" } as never)).toBe("https://app.example.com");
  });
});
