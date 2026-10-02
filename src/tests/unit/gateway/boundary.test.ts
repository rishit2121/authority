import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Static guarantees about where the gateway credential and the `pg` driver may
 * appear. These are source-level checks that complement the post-build bundle
 * scan (scripts/check-bundle-secrets.mjs), which inspects what actually ships.
 */
const SRC = path.join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC).filter((f) => !f.includes(`${path.sep}tests${path.sep}`));
const rel = (f: string) => path.relative(process.cwd(), f);
const read = (f: string) => readFileSync(f, "utf8");

describe("gateway credential and driver isolation", () => {
  it("only src/lib/gateway/db.ts and the Postgres connector's own client import the pg driver", () => {
    // src/lib/connectors/postgres/pg-client.ts is a deliberate second
    // importer, not a crack in this boundary: it never reads
    // GATEWAY_DATABASE_URL (enforced by the next test below) and connects
    // only to a tenant-configured target database with that tenant's own
    // stored username/password -- a different credential, a different
    // database, and a different purpose than the gateway's own control-plane
    // connection this boundary exists to keep auditable in one place. See
    // that file's own module comment.
    const importers = files.filter((f) => /from\s+["']pg["']|require\(["']pg["']\)/.test(read(f))).map(rel);
    expect(importers.sort()).toEqual(
      [
        path.join("src", "lib", "gateway", "db.ts"),
        path.join("src", "lib", "connectors", "postgres", "pg-client.ts"),
      ].sort(),
    );
  });

  it("only db.ts reads GATEWAY_DATABASE_URL / _CA (scrub.ts merely lists the names)", () => {
    const readers = files
      .filter((f) => /process\.env\.GATEWAY_DATABASE_(URL|CA)/.test(read(f)))
      .map(rel)
      .sort();
    expect(readers).toEqual([path.join("src", "lib", "gateway", "db.ts")]);
  });

  it("db.ts is server-only, so any client import is a build error", () => {
    expect(read(path.join(SRC, "lib", "gateway", "db.ts"))).toMatch(/import\s+["']server-only["']/);
  });

  it("every module under lib/gateway that touches the database is server-only", () => {
    for (const f of files.filter((f) => f.includes(`${path.sep}lib${path.sep}gateway${path.sep}`))) {
      const text = read(f);
      if (
        /^import\s+(?!type\b)[^;]*from\s+["']\.\/(db|rpc)["']/m.test(text) ||
        f.endsWith("db.ts") ||
        f.endsWith("rpc.ts")
      ) {
        expect(text, rel(f)).toMatch(/import\s+["']server-only["']/);
      }
    }
  });

  it("no client component imports anything from the gateway", () => {
    const clients = files.filter((f) => /^["']use client["']/.test(read(f).trimStart()));
    expect(clients.length).toBeGreaterThan(0);
    for (const f of clients) expect(read(f), rel(f)).not.toMatch(/@\/lib\/gateway|from\s+["']pg["']/);
  });

  it("the service-role key is not used anywhere in application code (scrub.ts only lists its name for redaction)", () => {
    for (const f of files.filter((f) => !f.endsWith(path.join("semantic", "scrub.ts")))) {
      expect(read(f), rel(f)).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|service_role_key/i);
    }
  });

  it("no route or library calls the legacy anonymous RPCs", () => {
    for (const f of files) {
      expect(read(f), rel(f)).not.toMatch(
        /\.rpc\(\s*["'](authorize_tool_call|get_semantic_evaluation_context|record_semantic_shadow|record_agent_auth_failure)["']/,
      );
    }
  });
});
