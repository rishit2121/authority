import "server-only";

import pg from "pg";

import { validatePostgresHost } from "./network-guard";
import type { PostgresConnectionConfig } from "./types";

/**
 * The second (and only other) module in this application that imports `pg`
 * -- see src/lib/gateway/db.ts's own comment, updated to say "the gateway's
 * own credential" rather than claim exclusivity it no longer has. This
 * module never touches the gateway's own database or its
 * `GATEWAY_DATABASE_URL` credential; it connects to a tenant-configured
 * target database using that tenant's own stored username/password, for the
 * lifetime of exactly one query.
 *
 * A fresh, short-lived `pg.Client` per call -- not a pool keyed by
 * connection id -- deliberately: this is a serverless-friendly Next.js
 * deployment where a long-lived pool per tenant connection would leak
 * across invocations with no clean shutdown hook, and a tenant's own
 * database is not expected to receive enough call volume from this
 * connector to make per-call connection overhead material.
 */

export interface PostgresQueryOutcome {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

export async function runPostgresQuery(input: {
  config: PostgresConnectionConfig;
  username: string;
  password: string;
  sql: string;
  values: Array<string | number | boolean>;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<PostgresQueryOutcome> {
  await validatePostgresHost(input.config.host);

  const client = new pg.Client({
    host: input.config.host,
    port: input.config.port,
    database: input.config.database,
    user: input.username,
    password: input.password,
    ssl: input.config.sslmode === "require" ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: 10_000,
    query_timeout: input.timeoutMs,
    statement_timeout: input.timeoutMs,
  });

  const onAbort = () => {
    void client.end();
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await client.connect();
    const result = await client.query({ text: input.sql, values: input.values });
    return { rows: result.rows as Array<Record<string, unknown>>, rowCount: result.rowCount ?? 0 };
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    await client.end().catch(() => undefined);
  }
}
