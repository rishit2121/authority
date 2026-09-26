#!/usr/bin/env node
/**
 * Provisions (or rotates) the `authority_gateway` database login.
 *
 * The migration creates the role NOLOGIN so no credential is ever committed.
 * This script sets a fresh random password and writes GATEWAY_DATABASE_URL into
 * `.env.local` (gitignored). Re-running it IS the rotation procedure: the old
 * password stops working the moment the new one is set, so update every place
 * the URL is deployed (see docs/gateway/TRUST_MODEL.md).
 *
 * It needs the project owner's `postgres` password (SUPABASE_DB_PASSWORD in
 * `.supabase-cli.env`), uses it only for this one ALTER ROLE, and never prints
 * any password.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function loadEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0)
      out[t.slice(0, eq).trim()] = t
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
  }
  return out;
}

const cli = loadEnv(path.join(root, ".supabase-cli.env"));
const ref = process.env.SUPABASE_PROJECT_REF || cli.SUPABASE_PROJECT_REF;
const ownerPassword = process.env.SUPABASE_DB_PASSWORD || cli.SUPABASE_DB_PASSWORD;
if (!ref || !ownerPassword) {
  console.error("SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD are required (see .supabase-cli.env).");
  process.exit(1);
}

let host = "aws-0-us-east-1.pooler.supabase.com";
const poolerFile = path.join(root, "supabase", ".temp", "pooler-url");
if (existsSync(poolerFile)) {
  const m = /@([^:/]+)/.exec(readFileSync(poolerFile, "utf8"));
  if (m) host = m[1];
}

const password = randomBytes(24).toString("hex");
const admin = new pg.Client({
  host,
  port: 6543,
  user: `postgres.${ref}`,
  password: ownerPassword,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

await admin.connect();
try {
  // Literal is safe: hex only, generated here.
  await admin.query(`alter role authority_gateway login password '${password}'`);
} finally {
  await admin.end();
}

const url = `postgresql://authority_gateway.${ref}:${password}@${host}:6543/postgres`;
const envFile = path.join(root, ".env.local");
const existing = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const lines = existing.split("\n").filter((l) => !l.startsWith("GATEWAY_DATABASE_URL="));
while (lines.length && lines[lines.length - 1] === "") lines.pop();
lines.push(`GATEWAY_DATABASE_URL=${url}`, "");
writeFileSync(envFile, lines.join("\n"));
console.log("authority_gateway credential rotated; GATEWAY_DATABASE_URL written to .env.local");
