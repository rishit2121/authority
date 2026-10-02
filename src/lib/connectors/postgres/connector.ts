import "server-only";

import { getConnectorConnectionConfig, resolveConnectorSecret } from "@/lib/gateway/rpc-connector-secrets";
import { getPublishedPostgresQuery, type PublishedPostgresQuery } from "@/lib/gateway/rpc-postgres-queries";

import { connectionIdFromPostgresConnectorId, POSTGRES_CONNECTOR_PREFIX } from "./connection-id";
import { runPostgresQuery, type PostgresQueryOutcome } from "./pg-client";
import { buildQuery } from "./request-builder";
import {
  PostgresQueryValidationError,
  type PostgresConnectionConfig,
  type PostgresQueryInputSchema,
} from "./types";

import type {
  AuthorityConnector,
  ConnectorContext,
  ConnectorExecutionContext,
  ConnectorExecutionResult,
  ConnectorHealthResult,
  IndeterminateExecution,
  NormalizedConnectorRequest,
  ReconciliationResult,
} from "../types";
import type { ToolOperation } from "@/lib/registry/types";

/**
 * PostgreSQL: the second connector (after Custom API) whose operations are
 * tenant-published, not part of the static trusted registry (Phase 9 of the
 * agent-integration roadmap). Every tenant's own schema is different, so
 * there is no universal "retrieve a row" the way Stripe has "retrieve a
 * payment" -- see 20261001000013_postgres_query_definitions.sql's own
 * module comment for the full draft -> validated -> published -> retired
 * lifecycle this connector executes against.
 *
 * Dependency-injected exactly like Custom API's connector
 * (CustomApiConnectorDeps), for the same reason: tests swap the database
 * reads and, critically, `runQuery` itself for an in-memory fake, since
 * there is no "mock mode" equivalent to GitHub's mockGithub for a connector
 * whose target is a different arbitrary tenant database every time.
 */

export interface PostgresConnectorDeps {
  getPublishedQuery: typeof getPublishedPostgresQuery;
  getConnectionConfig: typeof getConnectorConnectionConfig;
  resolveSecret: typeof resolveConnectorSecret;
  runQuery: (input: {
    config: PostgresConnectionConfig;
    username: string;
    password: string;
    sql: string;
    values: Array<string | number | boolean>;
    timeoutMs: number;
    signal?: AbortSignal;
  }) => Promise<PostgresQueryOutcome>;
}

export const defaultPostgresConnectorDeps: PostgresConnectorDeps = {
  getPublishedQuery: getPublishedPostgresQuery,
  getConnectionConfig: getConnectorConnectionConfig,
  resolveSecret: resolveConnectorSecret,
  runQuery: runPostgresQuery,
};

function splitTool(tool: string): { connectionId: string; querySlug: string } {
  const dot = tool.indexOf(".");
  if (dot <= 0 || dot === tool.length - 1) {
    throw new PostgresQueryValidationError("TOOL_MALFORMED", `"${tool}" is not a valid tool name.`);
  }
  const provider = tool.slice(0, dot);
  const querySlug = tool.slice(dot + 1);
  const connectionId = connectionIdFromPostgresConnectorId(provider);
  if (!connectionId) {
    throw new PostgresQueryValidationError("TOOL_MALFORMED", `"${provider}" is not a Postgres connector id.`);
  }
  return { connectionId, querySlug };
}

function configOf(query: PublishedPostgresQuery): PostgresConnectionConfig {
  const config = query.connectionConfig as Partial<PostgresConnectionConfig>;
  if (!config.host || !config.port || !config.database) {
    throw new PostgresQueryValidationError(
      "CONNECTOR_NOT_CONFIGURED",
      "This connection has no database configured.",
    );
  }
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    sslmode: config.sslmode === "disable" ? "disable" : "require",
  };
}

function agentPayloadFrom(outcome: PostgresQueryOutcome): {
  payload: Record<string, unknown>;
  redaction: Record<string, number>;
} {
  // Rows are returned as-is: unlike an HTTP response (an opaque external
  // payload scrubbed only for content-type), a postgres query's own
  // declared column list is the admin's explicit choice of what an agent
  // may see -- the same trust boundary that already governs which SQL runs
  // at all. Capped defensively in case a published query was authored
  // without a LIMIT.
  const MAX_ROWS = 500;
  const truncated = outcome.rows.length > MAX_ROWS;
  return {
    payload: { rows: outcome.rows.slice(0, MAX_ROWS), rowCount: outcome.rowCount, truncated },
    redaction: {},
  };
}

export function createPostgresConnector(
  deps: PostgresConnectorDeps = defaultPostgresConnectorDeps,
): AuthorityConnector {
  async function loadPublished(
    tool: string,
  ): Promise<{ connectionId: string; query: PublishedPostgresQuery }> {
    const { connectionId, querySlug } = splitTool(tool);
    const query = await deps.getPublishedQuery(connectionId, querySlug);
    if (!query) {
      throw new PostgresQueryValidationError(
        "QUERY_NOT_PUBLISHED",
        "This query is not published on this connection.",
      );
    }
    return { connectionId, query };
  }

  async function credentialsFor(connectionId: string): Promise<{ username: string; password: string }> {
    const [username, password] = await Promise.all([
      deps.resolveSecret(connectionId, "basic_username"),
      deps.resolveSecret(connectionId, "basic_password"),
    ]);
    if (!username || !password) {
      throw new PostgresQueryValidationError(
        "CREDENTIAL_NOT_CONFIGURED",
        "Database credentials are not fully configured.",
      );
    }
    return { username, password };
  }

  return {
    id: POSTGRES_CONNECTOR_PREFIX,

    // Postgres has no statically trusted operations of its own -- every
    // query it exposes is a tenant's published row. See
    // ../custom-api/connector.ts's own comment on why this is correct, not
    // a placeholder, for a tenant-published connector.
    describeOperations(): ToolOperation[] {
      return [];
    },

    async verifyInstallation(context: ConnectorContext): Promise<ConnectorHealthResult> {
      const connection = await deps.getConnectionConfig(context.connectionId);
      if (!connection) {
        return { status: "disconnected", reasons: ["CONNECTION_NOT_FOUND"], lastVerifiedAt: null };
      }
      const config = connection.config as Partial<PostgresConnectionConfig>;
      const reasons: string[] = [];
      if (!config.host || !config.port || !config.database) reasons.push("DATABASE_NOT_CONFIGURED");
      const [username, password] = await Promise.all([
        deps.resolveSecret(context.connectionId, "basic_username"),
        deps.resolveSecret(context.connectionId, "basic_password"),
      ]);
      if (!username || !password) reasons.push("CREDENTIALS_NOT_CONFIGURED");
      return {
        status:
          reasons.length > 0 ? "not_configured" : connection.status === "active" ? "active" : "suspended",
        reasons,
        lastVerifiedAt: connection.lastVerifiedAt,
      };
    },

    async normalizeRequest(tool: string, input: unknown): Promise<NormalizedConnectorRequest> {
      // Unlike Custom API's base URL, a query's own SQL carries no
      // per-connection destination to resolve here -- `connectionId` only
      // matters at execute() time, to confirm it matches the reservation's
      // own resolved connection.
      const { query } = await loadPublished(tool);
      const built = buildQuery(
        {
          sqlTemplate: query.sqlTemplate,
          inputSchema: query.inputSchema as unknown as PostgresQueryInputSchema,
        },
        (input as Record<string, unknown>) ?? {},
      );
      return {
        tool: query.toolName,
        operation: tool,
        resource: built.resource,
        args: (input as Record<string, unknown>) ?? {},
      };
    },

    async execute(
      request: NormalizedConnectorRequest,
      context: ConnectorExecutionContext,
    ): Promise<ConnectorExecutionResult> {
      const { connectionId, query } = await loadPublished(request.operation);
      if (connectionId !== context.connectionId) {
        // Cannot happen if the tool name is well-formed (both are derived
        // from the same string), but a mismatch here must never silently
        // proceed -- this is the last check before a real query is built.
        throw new PostgresQueryValidationError(
          "CONNECTION_MISMATCH",
          "The resolved connection does not match the execution context.",
        );
      }
      if (query.connectionStatus !== "active") {
        throw new PostgresQueryValidationError("CONNECTION_UNAVAILABLE", "This connection is not active.");
      }
      const built = buildQuery(
        {
          sqlTemplate: query.sqlTemplate,
          inputSchema: query.inputSchema as unknown as PostgresQueryInputSchema,
        },
        request.args,
      );
      const config = configOf(query);
      const credentials = await credentialsFor(connectionId);

      const isWrite = query.effect !== "read";
      if (isWrite) context.beforeWrite();

      let outcome: PostgresQueryOutcome;
      try {
        outcome = await deps.runQuery({
          config,
          username: credentials.username,
          password: credentials.password,
          sql: built.sql,
          values: built.values,
          timeoutMs: query.timeoutMs,
          signal: context.signal,
        });
      } catch {
        // Never surface a raw driver error (connection string, SQLSTATE
        // detail, or a value echoed back in a constraint-violation message)
        // to the agent -- same scrubbing rule src/lib/gateway/db.ts applies
        // to the gateway's own database errors.
        throw new Error("QUERY_FAILED");
      }

      const { payload, redaction } = agentPayloadFrom(outcome);
      return {
        category: "succeeded",
        resourceIds: { resource: built.resource },
        providerRequestId: null,
        httpStatusClass: 2,
        agentPayload: payload,
        redaction,
      };
    },

    async reconcile(_execution: IndeterminateExecution): Promise<ReconciliationResult> {
      // A generic published query has no provider-defined, safe, idempotent
      // "did this already happen" lookup -- same limitation Custom API's own
      // connector documents. An indeterminate execution here always
      // resolves manually.
      return {
        outcome: "still_unknown",
        detail: "Postgres query operations have no generic reconciliation lookup.",
      };
    },
  };
}

export const postgresConnector: AuthorityConnector = createPostgresConnector();
