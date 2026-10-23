import { afterEach, describe, expect, it, vi } from "vitest";

const constructed: Array<Record<string, unknown>> = [];
const executed: string[] = [];
const failNext: string[] = [];

vi.mock("pg", () => {
  class Client {
    constructor(config: Record<string, unknown>) {
      constructed.push(config);
    }
    async connect() {}
    async query(q: string | { text: string }) {
      const text = typeof q === "string" ? q : q.text;
      executed.push(text);
      if (failNext[0] === text) {
        failNext.shift();
        throw new Error("forced");
      }
      return { rows: [], rowCount: 0 };
    }
    async end() {}
  }
  return { default: { Client } };
});

import { runPostgresQuery } from "@/lib/connectors/postgres/pg-client";

const base = {
  username: "reader",
  password: "pw",
  sql: "select 1",
  values: [],
  timeoutMs: 1000,
};

describe("runPostgresQuery connects to the validated address", () => {
  afterEach(() => {
    constructed.length = 0;
    executed.length = 0;
    vi.restoreAllMocks();
  });

  it("connects to the resolved address and verifies TLS against the configured hostname", async () => {
    const dns = await import("node:dns/promises");
    vi.spyOn(dns.default, "lookup").mockResolvedValue([{ address: "10.0.0.7", family: 4 }] as never);
    await runPostgresQuery({
      ...base,
      config: { host: "db.internal.example", port: 5432, database: "app", sslmode: "require" } as never,
    });
    expect(constructed[0]).toMatchObject({
      host: "10.0.0.7",
      ssl: { rejectUnauthorized: true, servername: "db.internal.example" },
    });
  });

  it("never constructs a client when the answer contains a prohibited address", async () => {
    const dns = await import("node:dns/promises");
    vi.spyOn(dns.default, "lookup").mockResolvedValue([{ address: "0:0:0:0:0:0:0:1", family: 6 }] as never);
    await expect(
      runPostgresQuery({
        ...base,
        config: { host: "db.internal.example", port: 5432, database: "app", sslmode: "require" } as never,
      }),
    ).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    expect(constructed).toHaveLength(0);
  });

  it("refuses an equivalent loopback literal as the configured host", async () => {
    await expect(
      runPostgresQuery({
        ...base,
        config: { host: "::ffff:7f00:1", port: 5432, database: "app", sslmode: "disable" } as never,
      }),
    ).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    expect(constructed).toHaveLength(0);
  });
});

describe("runPostgresQuery: declared reads run in a read-only transaction", () => {
  afterEach(() => {
    constructed.length = 0;
    executed.length = 0;
    vi.restoreAllMocks();
  });

  const literalConfig = { host: "10.0.0.9", port: 5432, database: "app", sslmode: "disable" } as never;

  it("wraps a read in BEGIN READ ONLY ... COMMIT", async () => {
    await runPostgresQuery({ ...base, config: literalConfig, readOnly: true });
    expect(executed).toEqual(["BEGIN READ ONLY", "select 1", "COMMIT"]);
  });

  it("rolls back and rethrows when the read fails (for example a write attempted inside a function)", async () => {
    failNext.push("select 1");
    await expect(runPostgresQuery({ ...base, config: literalConfig, readOnly: true })).rejects.toThrow(
      "forced",
    );
    expect(executed).toEqual(["BEGIN READ ONLY", "select 1", "ROLLBACK"]);
  });

  it("runs a write as a single statement, unchanged", async () => {
    await runPostgresQuery({ ...base, config: literalConfig, sql: "update t set x = $1", readOnly: false });
    expect(executed).toEqual(["update t set x = $1"]);
  });
});
