import "server-only";

import { safeLog } from "@/lib/semantic/scrub";

import pg from "pg";

/**
 * The ONLY module in the application that holds the gateway database
 * credential or imports `pg`.
 *
 * `GATEWAY_DATABASE_URL` names the dedicated `authority_gateway` login. That
 * role owns nothing, has no table privileges, and can execute only functions
 * in the non-exposed `gateway` schema (see docs/gateway/TRUST_MODEL.md). This
 * is deliberately NOT the Supabase service-role key.
 *
 * Handling rules kept in this file so they can be audited in one place:
 *  - the URL is read here and nowhere else, never exported, never logged;
 *  - `server-only` makes any import from a client component a build error;
 *  - a failure surfaces only the Postgres SQLSTATE — never the message, the
 *    statement or its parameters, all of which may carry request content.
 */

export class GatewayNotConfiguredError extends Error {
  constructor() {
    super("The gateway database credential is not configured.");
    this.name = "GatewayNotConfiguredError";
  }
}

export class GatewayDatabaseError extends Error {
  readonly sqlstate: string;
  constructor(sqlstate: string) {
    super(`gateway database call failed (sqlstate ${sqlstate})`);
    this.name = "GatewayDatabaseError";
    this.sqlstate = sqlstate;
  }
}

const globalForPool = globalThis as unknown as { __authorityGatewayPool?: pg.Pool };

function createPool(): pg.Pool {
  const raw = process.env.GATEWAY_DATABASE_URL?.trim();
  if (!raw) throw new GatewayNotConfiguredError();

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GatewayNotConfiguredError();
  }

  const ca = process.env.GATEWAY_DATABASE_CA?.trim();
  const pool = new pg.Pool({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, "") || "postgres",
    // With GATEWAY_DATABASE_CA set the server certificate is verified. Without
    // it the connection is encrypted but the pooler's certificate chain is not
    // checked — a documented gap (docs/gateway/TRUST_MODEL.md).
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
    max: Number(process.env.GATEWAY_DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 12_000,
    query_timeout: 15_000,
    application_name: "authority-gateway",
  });
  // A dropped idle connection must not crash the process or print its detail.
  pool.on("error", () => {
    safeLog("gateway pool: idle client error");
  });
  return pool;
}

function pool(): pg.Pool {
  globalForPool.__authorityGatewayPool ??= createPool();
  return globalForPool.__authorityGatewayPool;
}

export function isGatewayConfigured(): boolean {
  return Boolean(process.env.GATEWAY_DATABASE_URL?.trim());
}

/**
 * Whether the gateway verifies the database server's certificate chain. Without
 * GATEWAY_DATABASE_CA the connection is encrypted but the peer is not
 * authenticated. Production readiness fails in that state rather than quietly
 * running with a man-in-the-middle-able connection.
 */
export function gatewayTlsVerified(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GATEWAY_DATABASE_CA?.trim());
}

/** True when this process is a production deployment that must not run with unverified TLS. */
export function gatewayTlsRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" && env.AUTHORITY_DEPLOYMENT !== "local";
}

/** Runs one parameterized statement. Parameters are never logged and never appear in errors. */
export async function gatewayQuery<Row extends Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<Row[]> {
  try {
    const result = await pool().query(text, params as unknown[]);
    return result.rows as Row[];
  } catch (error) {
    if (error instanceof GatewayNotConfiguredError) throw error;
    const code = (error as { code?: string })?.code ?? "unknown";
    safeLog(`gateway database error (sqlstate ${code})`);
    throw new GatewayDatabaseError(code);
  }
}

export async function closeGatewayPool(): Promise<void> {
  const existing = globalForPool.__authorityGatewayPool;
  globalForPool.__authorityGatewayPool = undefined;
  await existing?.end();
}
