import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EXPECTED_SCHEMA_VERSION } from "@/lib/gateway/schema-version";

describe("schema version", () => {
  it("matches the newest migration file, so a new migration cannot ship without bumping the probe", () => {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const newest = readdirSync(dir)
      .filter((f) => /^\d{14}_.*\.sql$/.test(f))
      .map((f) => f.slice(0, 14))
      .sort()
      .at(-1);
    expect(EXPECTED_SCHEMA_VERSION).toBe(newest);
  });
});
