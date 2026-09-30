import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error plain ESM script module without types
import { scanDirectory, secretValuesFromEnv } from "../../../../scripts/lib/bundle-scan.mjs";

function bundle(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "bundle-"));
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(dir, name);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

describe("bundle scanner", () => {
  it("passes a clean bundle", () => {
    const { findings, scanned } = scanDirectory(
      bundle({ "a.js": "console.log('hello')", "chunks/b.js": "export const x=1" }),
    );
    expect(scanned).toBe(2);
    expect(findings).toEqual([]);
  });

  it.each([
    "authority_gateway",
    "GATEWAY_DATABASE_URL",
    "pg-pool",
    "postgresql://u:p@h/db",
    "gateway.commit_authorization",
    "SUPABASE_SERVICE_ROLE_KEY",
  ])("detects the forbidden identifier %s", (id) => {
    const { findings } = scanDirectory(bundle({ "chunks/leak.js": `var a="${id}"` }));
    expect(findings.length).toBeGreaterThan(0);
  });

  it("detects the literal value of a configured secret without reporting the value", () => {
    const env = {
      GATEWAY_DATABASE_URL: "postgresql://authority_gateway.ref:hunter2hunter2hunter2@h:6543/postgres",
      SEMANTIC_PROVIDER_API_KEY: "sk-live-abcdefghij123456",
    };
    const dir = bundle({
      "x.js": "var k='sk-live-abcdefghij123456'",
      "y.js": "var p='hunter2hunter2hunter2'",
    });
    const { findings } = scanDirectory(dir, secretValuesFromEnv(env));
    const labels = findings.map((f: { label: string }) => f.label);
    expect(labels).toContain("secret-value:SEMANTIC_PROVIDER_API_KEY");
    expect(labels).toContain("secret-value:GATEWAY_DATABASE_PASSWORD");
    expect(JSON.stringify(findings)).not.toContain("hunter2hunter2hunter2");
    expect(JSON.stringify(findings)).not.toContain("sk-live-abcdefghij123456");
  });

  it("detects a leaked OPENROUTER_API_KEY value without reporting it", () => {
    const env = { OPENROUTER_API_KEY: "sk-or-v1-abcdefghij123456" };
    const dir = bundle({ "x.js": "var k='sk-or-v1-abcdefghij123456'" });
    const { findings } = scanDirectory(dir, secretValuesFromEnv(env));
    const labels = findings.map((f: { label: string }) => f.label);
    expect(labels).toContain("secret-value:OPENROUTER_API_KEY");
    expect(JSON.stringify(findings)).not.toContain("sk-or-v1-abcdefghij123456");
  });

  it("ignores very short values that would false-match", () => {
    const { findings } = scanDirectory(bundle({ "x.js": "abc" }), [{ label: "S", value: "abc" }]);
    expect(findings).toEqual([]);
  });
});
