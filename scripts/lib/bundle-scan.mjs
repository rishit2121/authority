import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Scans built browser assets for anything that must never ship to a client:
 * gateway/database identifiers and the literal value of any configured secret.
 * Reports file paths and the *label* of what matched — never the matched value.
 */
export const FORBIDDEN_IDENTIFIERS = [
  "authority_gateway",
  "GATEWAY_DATABASE_URL",
  "GATEWAY_DATABASE_CA",
  "SEMANTIC_PROVIDER_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "gateway.commit_authorization",
  "gateway.prepare_authorization",
  "gateway.consume_capability",
  "pg-pool",
  "postgresql://",
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** @param {string} dir  @param {{label: string, value: string}[]} secretValues */
export function scanDirectory(dir, secretValues = []) {
  const findings = [];
  const files = walk(dir).filter((f) => !/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|svg\.map)$/.test(f));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const id of FORBIDDEN_IDENTIFIERS) {
      if (text.includes(id)) findings.push({ file, label: `identifier:${id}` });
    }
    for (const { label, value } of secretValues) {
      if (value && value.length >= 8 && text.includes(value))
        findings.push({ file, label: `secret-value:${label}` });
    }
  }
  return { scanned: files.length, findings };
}

export function secretValuesFromEnv(env) {
  const out = [];
  for (const name of [
    "SEMANTIC_PROVIDER_API_KEY",
    "SEMANTIC_PROVIDER_API_KEY_SECONDARY",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    if (env[name]) out.push({ label: name, value: env[name] });
  }
  if (env.GATEWAY_DATABASE_URL) {
    out.push({ label: "GATEWAY_DATABASE_URL", value: env.GATEWAY_DATABASE_URL });
    try {
      out.push({
        label: "GATEWAY_DATABASE_PASSWORD",
        value: decodeURIComponent(new URL(env.GATEWAY_DATABASE_URL).password),
      });
    } catch {
      /* not a URL */
    }
  }
  return out;
}
