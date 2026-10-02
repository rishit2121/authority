import type { PostgresQueryOutcome } from "@/lib/connectors/postgres/pg-client";
import type { PostgresConnectionConfig } from "@/lib/connectors/postgres/types";

/**
 * A local, in-memory fixture standing in for a tenant's real Postgres
 * database -- the Postgres connector equivalent of Custom API's
 * `WidgetOrdersFixtureApi`. Injected as `PostgresConnectorDeps.runQuery`,
 * never a real socket: there is no sandboxed Postgres instance this
 * connector could safely point itself at in tests, the same reason
 * Custom API's own tests use an in-memory fixture instead of a real
 * third-party API.
 *
 * Understands exactly the two statements the integration test's queries
 * use (a parameterized SELECT and a parameterized UPDATE against an
 * in-memory "orders" table), matching the real request shape (sql text +
 * positional values) `runPostgresQuery` would hand to a real `pg.Client`.
 */
export interface FixtureOrder {
  id: string;
  customerId: string;
  status: string;
}

export interface RecordedQuery {
  sql: string;
  values: Array<string | number | boolean>;
  config: PostgresConnectionConfig;
  username: string;
}

export class PostgresFixtureApi {
  readonly orders = new Map<string, FixtureOrder>([
    ["ord_1", { id: "ord_1", customerId: "cust_1", status: "pending" }],
    ["ord_2", { id: "ord_2", customerId: "cust_1", status: "pending" }],
  ]);
  readonly queries: RecordedQuery[] = [];
  requiredUsername: string | null = null;
  requiredPassword: string | null = null;

  /** Matches `PostgresConnectorDeps["runQuery"]` exactly -- drop-in for `runPostgresQuery` in tests. */
  runQuery = async (input: {
    config: PostgresConnectionConfig;
    username: string;
    password: string;
    sql: string;
    values: Array<string | number | boolean>;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<PostgresQueryOutcome> => {
    this.queries.push({
      sql: input.sql,
      values: input.values,
      config: input.config,
      username: input.username,
    });

    if (
      (this.requiredUsername && input.username !== this.requiredUsername) ||
      (this.requiredPassword && input.password !== this.requiredPassword)
    ) {
      throw new Error("password authentication failed");
    }

    const selectMatch = /^select id, status from orders where customer_id = \$1$/.exec(input.sql);
    if (selectMatch) {
      const rows = [...this.orders.values()].filter((o) => o.customerId === input.values[0]);
      return { rows: rows.map((o) => ({ id: o.id, status: o.status })), rowCount: rows.length };
    }

    const updateMatch = /^update orders set status = \$1 where id = \$2$/.exec(input.sql);
    if (updateMatch) {
      const order = this.orders.get(String(input.values[1]));
      if (!order) return { rows: [], rowCount: 0 };
      order.status = String(input.values[0]);
      return { rows: [{ id: order.id, status: order.status }], rowCount: 1 };
    }

    throw new Error(`fixture does not understand this query: ${input.sql}`);
  };
}
